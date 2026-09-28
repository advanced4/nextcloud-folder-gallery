# Nextcloud Folder Gallery

A free, read-only userscript that shows one cover image per Nextcloud folder.
Install with **Tampermonkey** or **Violentmonkey**. No Nextcloud app, backend,
extra account, or runtime dependency is required.

**[Install and copy the script](https://advanced4.github.io/nextcloud-folder-gallery/)**

## Rules

- Configure your own comma-separated path keywords in the browser after installation.
- Path and preview-name matching are case-insensitive substring matches.
- For a matching current directory, list each immediate child folder.
- Inside each child, choose a directly contained PNG/JPG/JPEG whose name includes
  `preview`. Use natural filename order when more than one qualifies.
- No recursive scans, archive extraction, or generated renders.
- Folders with no cover stay accessible. With no covers at all, retain normal Files.
- Search filters the listed folder names. ZIP downloads use Nextcloud's own DAV endpoint.
- Refresh rescans uploaded/changed files. No persistent catalog or preview cache.

## Privacy and permissions

Only the generic code and instructions live on GitHub Pages. Never commit server
addresses, credentials, private configuration, actual filenames, preview images,
screenshots of a real library, or captured API responses.

The HTTPS match patterns cover Nextcloud Files URL shapes on any host. At runtime
the script requires the signed-in Nextcloud Files DOM and, before reading folders,
a locally configured matching keyword. Requests are same-origin and use the existing
session; redirects are rejected. The script has no cross-origin request privilege.
Keywords are stored with the userscript manager, separately per origin, installation
path, and account. They are not sent to the project site. Manager-level cloud sync,
if explicitly enabled by a user, follows that manager's own behavior.

The manager can fetch code updates from GitHub Pages. Disable auto-updates in your
manager if you prefer reviewing each revision manually. Use only one manager for
this script to avoid running it twice.

The script reads files but never uploads, edits, shares, renames, or deletes them.
Nextcloud enforces access permissions. A hidden-download flag suppresses the ZIP
link and excludes a flagged preview image. Public link shares and end-to-end
encrypted folders are not supported in this version.

## Compatibility

Target: desktop Chrome/Edge/Firefox with Tampermonkey or Violentmonkey and the
Nextcloud 33 Files interface. The script uses standard DOM/fetch plus the managers'
shared `GM_getValue`, `GM_setValue`, and `GM_registerMenuCommand` APIs.

The page integration uses `#app-content-vue > .files-list`. It does not access
Nextcloud's internal Vue stores. If Nextcloud changes this markup, the script
leaves the normal file view untouched. Other server/browser/manager combinations
must be tested before claiming support. See [verification](VERIFICATION.md).

To reconfigure: script manager menu -> Configure folder previews for this Nextcloud
account. Empty keywords disable the gallery. To uninstall: remove the userscript
and reload Nextcloud. No server cleanup is necessary.

## Development

```sh
npm ci
npm run check
npm test
```

`docs/nextcloud-folder-gallery.user.js` is the single source and shipped artifact.
`docs/` is a static GitHub Pages site; publish it from the `main` branch.
Tests use synthetic filenames and an example.invalid server only.

API reference: [Nextcloud WebDAV](https://docs.nextcloud.com/server/stable/developer_manual/client_apis/WebDAV/basic.html).
Folder ZIP query behavior was checked against the
[Nextcloud 33.0.4 download action](https://github.com/nextcloud/server/blob/v33.0.4/apps/files/src/actions/downloadAction.ts).

MIT licensed; icon notices are in [THIRD_PARTY.md](THIRD_PARTY.md).
