# Two Kids Google Drive uploads

The destination is `testExp1/Two Kids`, folder ID
`1j8v13wvo8XLa8dLDBtPxVDV_egBMRHyu`.

The shared Apps Script web-game deployment was updated to version 8 on
2026-10-16. Its URL is unchanged. The original cake-session-upsert-v1 handler
is retained as `cakeDoPost_`, including its Kid RL-SA and Stag Hunt routing.
Add `scripts/two-kids-drive-handler.gs` alongside that handler and dispatch:

```js
function doPost(event) {
  const p = (event && event.parameter) || {};
  return isTwoKidsUpload_(p) ? saveTwoKids_(p) : cakeDoPost_(event);
}
```

The script uses the existing Advanced Drive v3 service, `WORKBOOK_MIME` and
`jsonResponse_` helper. Keep these definitions and other study routes intact.
The readiness response also exposes `twoKidsFolderId`.

New clients POST to `/api/kids/drive-upload`. The Node server forwards the
workbook and verifies the receipt's folder, filename, file ID, binary SHA-256,
and revision. The page only confirms cloud saving after this receipt. Failed
uploads retain the local Excel backup and show that cloud saving is unconfirmed.
The Node endpoint must be deployed together with the new client build.

The script updates an existing file in place, preserves its ID, accepts an
identical retry, rejects stale revisions and prevents snapshots from reopening
completed sessions. Legacy canonical Two Kids clients remain supported through
the old Excel form payload and UUID filename. Both routes verify the workbook's
`kids-canonical-events-v1` marker before saving. Historical noncanonical exports
are not automatically classified or migrated.

Validation on 2026-10-16: 42 automated tests passed; production build passed.
An actual local 2P3G human/SA browser session uploaded a 63,894-byte workbook.
The raw workbook fetched back from Drive matched the local download byte for
byte; the collabAIdata adapter validated 1 trial / 26 moves. SHA-256:
`ee2ff05f9c2670cbd42d408a3133cdf151e35f1bef45b6f4c27d3c88774d8a60`.
A separate explicitly named UPLOAD_RETRY_TEST workbook verified create,
identical retry, final update with the same file ID, and stale-upload rejection
against the live Apps Script deployment. Test workbooks are marked test sessions.

Apps Script deployment is confirmed. This does not establish that Render has
rebuilt the new Node/client code; verify that deployment separately.
