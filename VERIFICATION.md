# Verification

Automated tests exercise the actual distributed script inside a synthetic DOM:
setup/privacy boundaries, matching, XML parsing, preview selection, URL encoding,
download links, concurrency, errors, navigation cancellation, refresh, and search.

## Verified for 0.1.1

- 15 automated tests pass; JavaScript syntax checks pass.
- Fresh installations automatically match case-insensitive `poliigon` paths,
  without a setup prompt or writing settings. Unrelated paths remain untouched.
- PNG/JPG/JPEG filenames containing `sphere` or `preview` qualify, case-insensitively.
- Existing private overrides and explicit disable settings continue to work.
- This update's changed rules were validated in the synthetic DOM tests; a live
  userscript-manager update has not yet been verified.

## Verified for 0.1.0

- 12 automated tests pass; JavaScript syntax checks pass.
- Live Nextcloud 33.0.4, Chrome: temporarily executed the distributed script with
  test substitutes for the three userscript-manager storage/menu functions.
- Folder listing and supplied preview images load through the authenticated session.
- Search filters the gallery; switching back restores the native Files list.
- Desktop and 390-pixel-wide layout inspected; no horizontal page overflow.
- A folder ZIP downloaded through the gallery; archive contents could be listed.
- Real server URLs, names, responses, images, and browser screenshots are excluded
  from this repository.
- Tampermonkey installation was confirmed by the user; the setup button appeared
  on a fresh Nextcloud page, and the user subsequently reported the gallery working.

## Not yet verified

- End-to-end installation inside Violentmonkey and an independent persistence check.
- Firefox, Edge, and mobile extension execution.
- Other Nextcloud versions, alternate themes, and restricted-share scenarios.

Compatibility targets are not proof that every combination works.
