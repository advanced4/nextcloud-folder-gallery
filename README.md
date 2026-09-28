# Nextcloud Folder Gallery

A free, read-only userscript that shows one cover image per Nextcloud folder.
Install with **Tampermonkey** or **Violentmonkey**. No Nextcloud app, backend,
extra account, or runtime dependency is required.

**[Install and copy the script](https://advanced4.github.io/nextcloud-folder-gallery/)**

## Rules

- Works automatically when the current folder path contains `poliigon`; no setup required.
- Optional private keyword overrides remain available in the script manager menu.
  Existing settings, including an explicitly disabled empty list, are preserved on update.
- Path and preview-name matching are case-insensitive substring matches.
- For a matching current directory, list its immediate child folders once.
- Inside each child, choose a directly contained PNG/JPG/JPEG whose name includes
  `preview` or `sphere`. Use natural filename order when more than one qualifies.
- No recursive scans, archive extraction, or generated renders.
- Inspect child folders only when their tiles are visible or within 400 pixels of the view.
- Folders with no cover stay accessible. Normal Files is always available via the toggle.
- Search filters the listed folder names. ZIP downloads use Nextcloud's own DAV endpoint.
- Refresh clears cached choices in the current directory and rescans nearby tiles.

## Requests and caching

The gallery requests Nextcloud's 256-pixel thumbnails, preserving aspect ratio,
instead of downloading the original images. Nextcloud handles thumbnail generation
and HTTP caching. Image URLs include the image ETag and account identity so changed
images and different accounts do not reuse the same browser-cache key. Failed
thumbnails show a placeholder; they never fall back to large original downloads.

Each visit makes one fresh parent-directory listing. Up to four child-folder
listings run concurrently, only for nearby tiles without a valid cached choice.
Scrolling and searching bring more tiles into view. Switching to normal Files
pauses queued lookups; leaving the directory aborts ongoing lookups.

Discovery metadata is stored in this Nextcloud site's browser `localStorage`,
separated by installation and account, with a limit of 5,000 records per account.
It contains folder paths/IDs, change identifiers, and selected image IDs, not image
bodies or credentials. It is not stored in userscript-manager sync or sent to GitHub.
Folder ETag changes invalidate entries. Positive results expire after 24 hours;
"no preview" results expire after 5 minutes. Refresh bypasses both. Without a folder
ETag, the script does not reuse its discovery result. Storage failures are reported
and the gallery continues without persistent caching.

Cached visits still check the parent directory and authenticate thumbnail requests
as required by the browser's HTTP cache. This is not an offline asset mirror or a
security boundary: cached metadata remains on the browser until cleared or evicted.
Clearing site data removes it. Images follow the browser's normal cache lifecycle.
All folder tiles are still created in the DOM; rendering is not virtualized.

## Privacy and permissions

Only the generic code and instructions live on GitHub Pages. Never commit server
addresses, credentials, private configuration, actual filenames, preview images,
screenshots of a real library, or captured API responses.

The HTTPS match patterns cover Nextcloud Files URL shapes on any host. At runtime
the script requires the signed-in Nextcloud Files DOM and, before reading folders,
a matching path keyword (the public default is `poliigon`). Requests are same-origin and use the existing
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
Thumbnail parameters and caching were checked against the
[33.0.4 preview controller](https://github.com/nextcloud/server/blob/v33.0.4/core/Controller/PreviewController.php),
and folder ETag propagation against its
[cache updater](https://github.com/nextcloud/server/blob/v33.0.4/lib/private/Files/Cache/Updater.php).

MIT licensed; icon notices are in [THIRD_PARTY.md](THIRD_PARTY.md).
