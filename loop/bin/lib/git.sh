#!/usr/bin/env bash
# Version-control helpers for the *workspace* repo — the project the loop acts
# on, not this one. Pure git: every function takes an absolute repo path and
# knows nothing about slugs, db/ paths, or index.jsonl. Nothing here decides
# what the loop does next. Requires common.sh to already be sourced (die).
#
# --- Why the loop writes branch metadata into the workspace's .git/config ----
#
# A request's branch and the branch it was cut from have to survive an overseer
# restart, a released stint, and a machine reboot — the train outlives all
# three. They live in the workspace repo's own config:
#
#   branch.<branch>.looprequest   the request id that owns this branch
#   branch.<branch>.loopbase      what it was cut from (a branch, or origin/<default>)
#   branch.<branch>.looppr        the PR url (written by loop/bin/land)
#
# That is a linked list, and the list *is* the train:
#   origin/main <- feature/a <- hotfix/b <- change/c
#
# This looks like a violation of the README's "centralized db/ instead of
# writing into the workspace" rule. It is not: that rule exists so the tool's
# bookkeeping is never mistaken for project source or accidentally committed
# into someone's app repo. `.git/config` is neither tracked nor committable,
# and per-branch metadata is exactly where git itself keeps
# `branch.<b>.remote` and `branch.<b>.merge`. Nothing lands in the diff.
#
# Key names are lower-case on purpose. `git config --get-regexp` normalizes the
# variable half of a key to lower case while preserving the subsection's case,
# so a key written `loopRequest` reads back `looprequest` — naming them that
# way to begin with removes the trap rather than documenting it.

LOOP_GIT_KEY_REQUEST=looprequest
LOOP_GIT_KEY_BASE=loopbase
LOOP_GIT_KEY_PR=looppr

# git_ws <repo> <args…> — git, in that repo. Every call goes through here so
# no caller has to remember -C, and so a `cd` can never leak between them.
git_ws() {
  local repo=$1
  shift
  git -C "$repo" "$@"
}

# git_is_repo <repo> — 0 if that directory is the root of a git work tree.
git_is_repo() {
  [ -d "$1/.git" ] || git_ws "$1" rev-parse --git-dir >/dev/null 2>&1
}

# git_has_origin <repo> — 0 if an `origin` remote is configured.
git_has_origin() {
  git_ws "$1" remote get-url origin >/dev/null 2>&1
}

# git_require_repo <repo> <workspace-name> — die unless the workspace is a git
# repo with an origin. Both are hard preconditions for the commit step: a
# request's work has to go onto a branch and out to a pull request, and neither
# is possible without them. Exit 4, distinct from the stint's own refusals, so
# a caller can tell "this project is not set up for it" from "not right now".
git_require_repo() {
  local repo=$1 name=$2
  git_is_repo "$repo" || die "workspace '$name' is not a git repository
The loop commits a request's work to its own branch and opens a pull request,
which needs a repository to do it in:
  git -C $repo init" 4
  git_has_origin "$repo" || die "workspace '$name' has no 'origin' remote
A request's branch is pushed to origin and its pull request opened there, so
the loop cannot take this project past 'implement' without one:
  git -C $repo remote add origin <url>" 4
}

# git_default_ref <repo> — the remote-tracking ref new work ultimately targets,
# as a name usable with merge-base: origin/HEAD's target when it resolves, then
# origin/main, then origin/master. Prints nothing and returns 1 when none of
# them exist, which is a repo that has an origin it has never fetched.
git_default_ref() {
  local repo=$1 head ref
  if head=$(git_ws "$repo" symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null); then
    printf '%s' "${head#refs/remotes/}"
    return 0
  fi
  for ref in origin/main origin/master; do
    if git_ws "$repo" show-ref --verify --quiet "refs/remotes/$ref"; then
      printf '%s' "$ref"
      return 0
    fi
  done
  return 1
}

# git_require_default_ref <repo> <workspace-name> — git_default_ref or die.
git_require_default_ref() {
  local repo=$1 name=$2 ref
  ref=$(git_default_ref "$repo") || die "workspace '$name' has no default branch on origin
The loop needs to know what a request's work is ultimately merged into.
Neither origin/HEAD, origin/main nor origin/master resolves — fetch, then
point origin/HEAD at the right branch:
  git -C $repo fetch origin && git -C $repo remote set-head origin -a" 4
  printf '%s' "$ref"
}

# git_tree_clean <repo> — 0 when nothing is modified, staged or untracked.
git_tree_clean() {
  [ -z "$(git_ws "$1" status --porcelain)" ]
}

# git_dirty_paths <repo> — the short status, for an error message.
git_dirty_paths() {
  git_ws "$1" status --short
}

# git_branch_prefix <kind> — the branch namespace for a request's kind. The
# request record's `kind` is an enum bash already validates, so this is total.
git_branch_prefix() {
  case "$1" in
    feature) printf 'feature' ;;
    fix)     printf 'hotfix' ;;
    change)  printf 'change' ;;
    epic)    printf 'epic' ;;
    *)       printf 'change' ;;
  esac
}

# git_branch_name <kind> <id> <title> — the branch a request owns.
#
#   <prefix>/<title, slugged and truncated>-<the id's 8 hex chars>
#   feature/add-an-ai-section-to-resume-a4afc3d2
#
# A pure function of values that never change after the `request` step, so it
# is reproducible: the same request always names the same branch, and two
# requests never collide, because the id suffix is random. Unlike slugify()
# this collapses runs and strips dots — a run of dashes is ugly, but `..` and a
# trailing `.` are illegal in a refname, and a dot in the subsection makes the
# config key ambiguous to read back.
git_branch_name() {
  local kind=$1 id=$2 title=$3 slug
  slug=$(printf '%s' "$title" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' \
    | cut -c1-40 \
    | sed -E 's/-+$//')
  [ -n "$slug" ] || slug=request
  printf '%s/%s-%s' "$(git_branch_prefix "$kind")" "$slug" "${id##*_}"
}

# git_branch_exists <repo> <branch>
git_branch_exists() {
  git_ws "$1" show-ref --verify --quiet "refs/heads/$2"
}

# git_config_branches <repo> — every `<branch><TAB><request-id>` the config
# claims. `--get-regexp` exits 1 when nothing matches, which is a normal empty
# train and not an error, hence the `|| true`.
#
# The branch is recovered by stripping the literal `branch.` prefix and the
# literal `.<key>` suffix — never by splitting on '.', because a branch name
# legally contains '/' and may contain '.'.
git_config_branches() {
  local repo=$1 line key branch id
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    key=${line%% *}
    id=${line#* }
    branch=${key#branch.}
    branch=${branch%".$LOOP_GIT_KEY_REQUEST"}
    [ -n "$branch" ] && [ -n "$id" ] || continue
    printf '%s\t%s\n' "$branch" "$id"
  done < <(git_ws "$repo" config --local --get-regexp \
    "^branch\\..*\\.$LOOP_GIT_KEY_REQUEST\$" 2>/dev/null || true)
}

# git_branch_meta <repo> <branch> <key> — one loop key off a branch, or empty.
git_branch_meta() {
  git_ws "$1" config --local --get "branch.$2.$3" 2>/dev/null || true
}

# git_set_branch_meta <repo> <branch> <key> <value>
git_set_branch_meta() {
  git_ws "$1" config --local "branch.$2.$3" "$4"
}

# git_unset_branch_meta <repo> <branch> — drop all three loop keys. This is how
# a request leaves the train: `loop/bin/close` calls it, and from then on the
# branch is invisible to git_train_rows. Keeping the "is it closed?" question
# out of this file is what lets it stay pure git — it never reads index.jsonl.
git_unset_branch_meta() {
  local repo=$1 branch=$2 key
  for key in "$LOOP_GIT_KEY_REQUEST" "$LOOP_GIT_KEY_BASE" "$LOOP_GIT_KEY_PR"; do
    git_ws "$repo" config --local --unset "branch.$branch.$key" 2>/dev/null || true
  done
}

# git_branch_landed <repo> <branch> <default-ref> — 0 when that branch is
# already contained in what origin's default branch points at.
#
# Note this is *ancestry*, so it is true only for a real merge commit. A
# squash- or rebase-merge rewrites the commits and ancestry never holds, which
# is why loop/bin/close does not treat this as the sole authority.
git_branch_landed() {
  git_ws "$1" merge-base --is-ancestor "$2" "$3" 2>/dev/null
}

# git_request_branch <repo> <id> — the branch that request owns, or empty.
git_request_branch() {
  local repo=$1 id=$2 branch rid
  while IFS=$'\t' read -r branch rid; do
    if [ "$rid" = "$id" ]; then
      printf '%s' "$branch"
      return 0
    fi
  done < <(git_config_branches "$repo")
  return 0
}

# git_train_rows <repo> — one `<branch><TAB><id><TAB><base><TAB><state>` line
# per branch the loop tracks, bases before the branches that depend on them.
# <state> is `landed` (already contained in the default ref) or `live`.
#
# A config entry whose ref has gone is dropped: the ref is the truth, the entry
# is a leftover. This is the only place the train is assembled.
git_train_rows() {
  local repo=$1 default_ref branch id base state
  local -a pend=() out=()
  default_ref=$(git_default_ref "$repo") || return 0

  while IFS=$'\t' read -r branch id; do
    git_branch_exists "$repo" "$branch" || continue
    base=$(git_branch_meta "$repo" "$branch" "$LOOP_GIT_KEY_BASE")
    [ -n "$base" ] || base=$default_ref
    state=live
    git_branch_landed "$repo" "$branch" "$default_ref" && state=landed
    pend+=("$branch	$id	$base	$state")
  done < <(git_config_branches "$repo")

  [ ${#pend[@]} -gt 0 ] || return 0

  # Topological emit: a row whose base is not (or is no longer) waiting in the
  # set has nothing in front of it, so it goes out. Repeat until nothing moves,
  # then flush whatever is left — a cycle can only come from hand-edited config
  # and is better reported in some order than not at all.
  local -a rest=()
  local progress=1 row rbranch other obranch blocked
  while [ ${#pend[@]} -gt 0 ] && [ "$progress" -eq 1 ]; do
    progress=0
    rest=()
    for row in "${pend[@]}"; do
      IFS=$'\t' read -r rbranch _ base _ <<<"$row"
      blocked=0
      for other in "${pend[@]}"; do
        obranch=${other%%	*}
        [ "$obranch" = "$rbranch" ] && continue
        [ "$obranch" = "$base" ] && blocked=1 && break
      done
      if [ "$blocked" -eq 0 ]; then
        out+=("$row")
        progress=1
      else
        rest+=("$row")
      fi
    done
    pend=("${rest[@]}")
  done
  [ ${#pend[@]} -eq 0 ] || out+=("${pend[@]}")

  printf '%s\n' "${out[@]}"
}

# git_train_tip <repo> — the branch a new request bases off: the live branch no
# other live branch names as its base, or the default ref when none exists.
#
# A landed branch is not a candidate, and neither is one whose metadata `close`
# has pruned — both drop out of git_train_rows before we get here, which is the
# whole of how a merged request stops affecting anyone. Requests already
# stacked behind it keep their recorded base: their history is written.
#
# A forked chain can leave two candidates. That can only come from a branch cut
# outside the loop, so rather than refuse — halting the loop over something
# recoverable — take the most recently committed and name both on stderr.
git_train_tip() {
  local repo=$1 branch base state claimed
  local -a rows=() tips=()
  while IFS= read -r line; do
    [ -n "$line" ] && rows+=("$line")
  done < <(git_train_rows "$repo")

  local line other obranch obase ostate
  for line in "${rows[@]}"; do
    IFS=$'\t' read -r branch _ _ state <<<"$line"
    [ "$state" = live ] || continue
    claimed=0
    for other in "${rows[@]}"; do
      IFS=$'\t' read -r obranch _ obase ostate <<<"$other"
      [ "$ostate" = live ] || continue
      [ "$obranch" = "$branch" ] && continue
      if [ "$obase" = "$branch" ]; then claimed=1; break; fi
    done
    [ "$claimed" -eq 0 ] && tips+=("$branch")
  done

  if [ ${#tips[@]} -eq 0 ]; then
    git_default_ref "$repo"
    return 0
  fi
  if [ ${#tips[@]} -eq 1 ]; then
    printf '%s' "${tips[0]}"
    return 0
  fi

  log_info "more than one branch could be the train's tip: ${tips[*]}"
  log_info "taking the most recently committed — $LOOP_BIN_DIR/train shows the whole chain"
  while IFS= read -r branch; do
    for other in "${tips[@]}"; do
      if [ "$other" = "$branch" ]; then
        printf '%s' "$branch"
        return 0
      fi
    done
  done < <(git_ws "$repo" for-each-ref --sort=-committerdate \
    --format='%(refname:short)' refs/heads 2>/dev/null)
  printf '%s' "${tips[0]}"
}

# git_base_ref <repo> <branch> — the branch's recorded base if it still
# resolves, else the default ref.
#
# A base legitimately dangles: when the request in front lands, `close` deletes
# its branch, and everything stacked behind keeps pointing at a name that has
# gone. Falling back to the default ref is right, because that is where the
# vanished base's commits now live.
git_base_ref() {
  local repo=$1 branch=$2 base
  base=$(git_branch_meta "$repo" "$branch" "$LOOP_GIT_KEY_BASE")
  if [ -n "$base" ] && git_ws "$repo" rev-parse --verify --quiet "$base^{commit}" >/dev/null 2>&1; then
    printf '%s' "$base"
    return 0
  fi
  git_default_ref "$repo"
}

# git_diff_range <repo> <id> — the `<base>...<branch>` range covering
# everything that request added, for a review to read. Empty when the request
# has no branch.
git_diff_range() {
  local repo=$1 id=$2 branch
  branch=$(git_request_branch "$repo" "$id")
  [ -n "$branch" ] || return 0
  printf '%s...%s' "$(git_base_ref "$repo" "$branch")" "$branch"
}

# --- Entering the stint -------------------------------------------------

# git_stint_enter <repo> <workspace-name> <id> <kind> <title> <already-held>
#
# Put the working tree on the branch this request owns, cutting it first if it
# does not have one. Called by loop/bin/step the moment a request takes the
# stint, which is what makes "a request starts from the correct
# branch" a precondition bash enforces rather than something the overseer is
# trusted to remember.
#
# The branch is cut here rather than at `commit` for one reason: by commit time
# the changes already exist, and deciding their base then means either a
# checkout that carries them somewhere they were never built against, or a
# rebase nobody asked for. Cutting first makes the request's diff exactly its
# own work, against exactly the tree it was written on.
#
# <already-held> is `1` when this request held the stint before this claim.
# It gates the clean-tree check and nothing else — see below.
git_stint_enter() {
  local repo=$1 name=$2 id=$3 kind=$4 title=$5 already_held=$6
  local branch base current

  git_require_repo "$repo" "$name"
  git_require_default_ref "$repo" "$name" >/dev/null

  branch=$(git_request_branch "$repo" "$id")
  current=$(git_ws "$repo" branch --show-current)

  if [ -n "$branch" ]; then
    # Re-entry: the request already owns a branch. Being dirty *on it* is the
    # normal state of a request mid-stint — that is what the stint is for — so
    # only a tree parked on some other branch has to be clean before we move it.
    if [ "$current" = "$branch" ]; then
      printf '%s' "$branch"
      return 0
    fi
    git_tree_clean "$repo" || git_stint_die_dirty "$repo" "$name" "$id" "$branch"
    git_ws "$repo" checkout --quiet "$branch"
    printf '%s' "$branch"
    return 0
  fi

  # First entry. A dirty tree here would ride somebody else's uncommitted work
  # into this request's branch and into its pull request, so it is refused —
  # *unless* this request already held the stint, which is the one case where
  # the changes in the tree are known to be its own. That happens to a request
  # that entered the stint before branches existed: it holds the lock, its work
  # is on whatever it was checked out on, and the right thing is to cut its
  # branch from HEAD and carry the changes over, not to demand it be clean.
  if [ "$already_held" != "1" ]; then
    git_tree_clean "$repo" || git_stint_die_dirty "$repo" "$name" "$id" ""
  fi

  branch=$(git_branch_name "$kind" "$id" "$title")
  git check-ref-format --branch "$branch" >/dev/null 2>&1 \
    || die "refusing to cut an invalid branch name for $id: '$branch'" 1

  if git_branch_exists "$repo" "$branch"; then
    # The name is taken but carries no metadata — a leftover from a cleared
    # request, or a human's branch that happens to match. Adopt it rather than
    # inventing a second name for the same work.
    git_ws "$repo" checkout --quiet "$branch"
    base=$(git_branch_meta "$repo" "$branch" "$LOOP_GIT_KEY_BASE")
    [ -n "$base" ] || base=$(git_default_ref "$repo")
  elif [ "$already_held" = "1" ]; then
    # Cut from HEAD, not from the tip: this work is already built on top of
    # whatever it is on top of, and moving it would be a rebase of changes
    # nobody has committed. `checkout -b` carries the dirty tree across.
    base=$(git_ws "$repo" rev-parse --abbrev-ref HEAD)
    git_ws "$repo" checkout --quiet -b "$branch"
  else
    # Fetch so the tip is judged against what origin actually has. A failure is
    # a warning, never fatal — halting `implement` on a network blip is worse
    # than a base a later rebase fixes.
    git_ws "$repo" fetch --quiet origin 2>/dev/null \
      || log_info "could not fetch origin — basing on the local view of it"
    base=$(git_train_tip "$repo")
    git_ws "$repo" checkout --quiet -b "$branch" "$base"
  fi

  git_set_branch_meta "$repo" "$branch" "$LOOP_GIT_KEY_REQUEST" "$id"
  git_set_branch_meta "$repo" "$branch" "$LOOP_GIT_KEY_BASE" "$base"
  log_info "cut branch '$branch' off '$base' for $id"
  printf '%s' "$branch"
}

# git_stint_die_dirty <repo> <workspace-name> <id> <branch> — the one refusal
# a human is most likely to hit, so it says what to run.
git_stint_die_dirty() {
  local repo=$1 name=$2 id=$3 branch=$4 where
  where="its own branch"
  [ -n "$branch" ] && where="'$branch'"
  die "cannot put $id on $where: '$name' has uncommitted changes
A request's branch is cut when it takes the working tree, so the tree must be
clean first — otherwise work that is not this request's rides along into its
branch and into its pull request. Commit, stash or discard them first:
  git -C $repo status --short
$(git_dirty_paths "$repo" | sed 's/^/  /')" 5
}

# --- Values bash derives from git for a step's frontmatter -------------------

# git_derived_value <repo> <id> <key> — the value a `git_keys` frontmatter key
# must carry, for the step table's column 11. Dies rather than printing empty:
# an empty expectation compared against an empty write would *pass*, which is
# exactly the presence-only hole the whole compare-don't-count rule exists to
# close.
git_derived_value() {
  local repo=$1 id=$2 key=$3 branch value
  branch=$(git_request_branch "$repo" "$id")
  [ -n "$branch" ] || die "no branch recorded for $id — it has not taken the working tree yet" 1
  case "$key" in
    branch)      printf '%s' "$branch" ;;
    base_branch) printf '%s' "$(git_base_ref "$repo" "$branch")" ;;
    pr_url)
      value=$(git_branch_meta "$repo" "$branch" "$LOOP_GIT_KEY_PR")
      [ -n "$value" ] || die "no pull request recorded for $id — $LOOP_BIN_DIR/land opens it" 1
      printf '%s' "$value"
      ;;
    *) die "unknown git-derived frontmatter key: $key" 1 ;;
  esac
}
