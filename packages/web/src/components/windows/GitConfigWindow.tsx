import { useState } from "react";
import { WConfirmButton, WInline, WTitle } from "./bits";
import type { GitAccessState, GitSshTestState } from "../../state/wizard";
import { StatusLight } from "../StatusLight";

/**
 * Every git configuration setting in one place: the container's ssh key, and
 * the identity commits made from here carry.
 *
 * Settings keeps only a status summary and the button that opens this — the
 * same split it draws for capabilities. This is where the setup actually
 * happens.
 *
 * The key is generated here and never uploaded — only the public half is ever
 * shown, so nothing secret crosses the browser. The test targets are the
 * hosts the workspace's own remotes point at rather than a fixed list of
 * public forges: a self-hosted host on a non-default port is exactly the case
 * a key is most needed for.
 */
export function GitConfigWindow({
  access,
  test,
  onGenerate,
  onRemove,
  onTest,
  onSaveIdentity,
}: {
  access?: GitAccessState;
  test?: GitSshTestState;
  onGenerate: () => void;
  onRemove: () => void;
  onTest: (host: string, port?: number) => void;
  onSaveIdentity: (name: string, email: string) => void;
}) {
  if (access === undefined) {
    return <div className="w-empty">the server has not reported git access</div>;
  }

  return (
    <div>
      <WTitle>ssh key</WTitle>
      {access.key === undefined ? (
        <>
          <p className="panel-note">
            no key yet. generating one makes an ssh keypair inside the
            container; you copy the public half to your git host. the private
            half never leaves.
          </p>
          <div className="btn-row">
            <button className="w-btn" onClick={onGenerate}>
              generate key
            </button>
          </div>
        </>
      ) : (
        <>
          {!access.permissionsOk && (
            <p className="panel-note">
              this key cannot be used — its file permissions are wrong, which
              usually means it was written under a different user id. generate
              a new one.
            </p>
          )}
          <WInline label="fingerprint" value={access.key.fingerprint} />
          <PublicKeyRow publicKey={access.key.publicKey} />
          <TestRow hosts={access.hosts} test={test} onTest={onTest} />
          <div className="btn-row">
            <WConfirmButton
              label="remove key"
              confirmLabel="really remove"
              onConfirm={onRemove}
            />
          </div>
        </>
      )}

      <WTitle>identity</WTitle>
      <IdentityRow identity={access.identity} onSave={onSaveIdentity} />
    </div>
  );
}

/** The public key, selectable and copyable. Shown in full rather than
 * truncated: the operator's next move is to paste the whole thing somewhere. */
function PublicKeyRow({ publicKey }: { publicKey: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <>
      <p className="panel-note">
        add this to your git host, then test the connection below.
      </p>
      <textarea
        className="w-input w-key"
        readOnly
        rows={3}
        value={publicKey}
        spellCheck={false}
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className="btn-row">
        <button
          className="w-btn"
          onClick={() => {
            void navigator.clipboard?.writeText(publicKey).then(
              () => setCopied(true),
              () => undefined,
            );
          }}
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
    </>
  );
}

function TestRow({
  hosts,
  test,
  onTest,
}: {
  hosts: GitAccessState["hosts"];
  test?: GitSshTestState;
  onTest: (host: string, port?: number) => void;
}) {
  // Nothing in the workspace uses ssh yet, so there is no host worth naming a
  // button after. github is the one guess worth offering.
  const targets = hosts.length > 0 ? hosts : [{ host: "github.com" }];

  return (
    <>
      {test !== undefined && (
        <WInline
          label="connection"
          value={
            <span className="w-inline-flex">
              {/* `attention` rather than a bespoke failure colour — a refused
                  key is something for the operator to act on, which is what
                  that word already means everywhere else. */}
              <StatusLight
                activity={
                  test.status === "working"
                    ? "working"
                    : test.ok
                      ? "done"
                      : "attention"
                }
              />
              {test.status === "working"
                ? `testing ${test.host}…`
                : `${test.host} · ${test.message ?? ""}`}
            </span>
          }
        />
      )}
      {test?.status === "done" && test.hostFingerprint && (
        <WInline label="host key" value={test.hostFingerprint} />
      )}
      <div className="btn-row">
        {targets.map((target) => (
          <button
            key={`${target.host}:${target.port ?? ""}`}
            className="w-btn"
            disabled={test?.status === "working"}
            onClick={() => onTest(target.host, target.port)}
          >
            test {target.host}
          </button>
        ))}
      </div>
    </>
  );
}

/**
 * The identity the app's own commits are authored under.
 *
 * Kept here rather than in a git config file because the container is handed
 * `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` from the host — empty when the host has
 * none — and git reads those ahead of any config file, so a config-file
 * identity would simply be ignored.
 */
function IdentityRow({
  identity,
  onSave,
}: {
  identity?: { name: string; email: string };
  onSave: (name: string, email: string) => void;
}) {
  const [name, setName] = useState(identity?.name ?? "");
  const [email, setEmail] = useState(identity?.email ?? "");
  const [saved, setSaved] = useState(false);

  const dirty = name !== (identity?.name ?? "") || email !== (identity?.email ?? "");
  const complete = name.trim().length > 0 && email.includes("@");

  return (
    <>
      <p className="panel-note">
        who commits made from here are authored as.
      </p>
      <WInline
        label="name"
        value={
          <input
            className="w-input"
            value={name}
            // Labelled explicitly: `WInline`'s label is adjacent text, not a
            // <label>, so without this the field has no accessible name at
            // all. "git author name" rather than anything containing "your
            // name" — the wizard's own name ask owns that phrasing, and two
            // textboxes answering to it made the e2e wizard helper type into
            // this window instead.
            aria-label="git author name"
            placeholder="Ada Lovelace"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
          />
        }
      />
      <WInline
        label="email"
        value={
          <input
            className="w-input"
            value={email}
            aria-label="git author email"
            placeholder="ada@example.com"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(e) => {
              setEmail(e.target.value);
              setSaved(false);
            }}
          />
        }
      />
      <div className="btn-row">
        <button
          className="w-btn"
          disabled={!complete || !dirty}
          onClick={() => {
            onSave(name.trim(), email.trim());
            setSaved(true);
          }}
        >
          {saved && !dirty ? "saved" : "save identity"}
        </button>
      </div>
    </>
  );
}
