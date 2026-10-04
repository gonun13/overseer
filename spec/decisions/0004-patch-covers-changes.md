# Patch releases cover changes

§8 of the architecture spec called for a MINOR bump on any addition *or observable behaviour change*,
leaving PATCH for fixes alone. That made a layout rearrangement — moving the provider widget, folding
the status rows into the right rail — a minor release, which is not how the operator numbers them.

What this changes in settled spec: MINOR is for new features; PATCH covers fixes, changes to how
existing features look or behave, and other minor work. Breaking changes still need the operator's
decision. Updated `architecture.md` §8, §8.2 and §8.5.

Earlier releases keep their numbers.
