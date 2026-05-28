# Google Drive Apps Script Excel-Only Upsert Endpoint

The kids flow uploads the same Excel workbook name after DOB, after each trial, after questionnaire, and at final save. To avoid duplicate files, the Apps Script endpoint replaces the existing file when `upsert=true`.

This endpoint intentionally saves only Excel files. JSON checkpoint uploads are ignored so Google Drive contains one workbook per participant/session.

```js
function doPost(e) {
  const folderName = "testExp1";

  try {
    let folder;
    const folders = DriveApp.getFoldersByName(folderName);
    if (folders.hasNext()) {
      folder = folders.next();
    } else {
      folder = DriveApp.createFolder(folderName);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filetype = e.parameter && e.parameter.filetype;

    if (filetype === "excel") {
      const filename = e.parameter.filename || `experiment_data_${timestamp}.xlsx`;
      const filedata = e.parameter.filedata;

      if (!filedata) {
        throw new Error("No Excel file data received");
      }

      const blob = Utilities.newBlob(
        Utilities.base64Decode(filedata),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename
      );

      if (e.parameter.upsert === "true") {
        const existingFiles = folder.getFilesByName(filename);
        while (existingFiles.hasNext()) {
          existingFiles.next().setTrashed(true);
        }
      }

      const file = folder.createFile(blob);

      return jsonResponse({
        status: "success",
        message: e.parameter.upsert === "true" ? "Excel file updated successfully" : "Excel file saved successfully",
        fileId: file.getId(),
        fileName: filename,
        folderName,
        snapshot: e.parameter.snapshot || "",
        snapshotReason: e.parameter.snapshotReason || "",
        sessionId: e.parameter.sessionId || "",
        participantId: e.parameter.participantId || ""
      });
    }

    // Do not create JSON or CSV files in Drive. The experiment should keep
    // checkpoints browser-local and update only the Excel workbook.
    return jsonResponse({
      status: "ignored",
      message: "Only Excel uploads are saved by this endpoint",
      filetype: filetype || "",
      folderName
    });
  } catch (error) {
    return jsonResponse({
      status: "error",
      message: error.toString(),
      folderName
    });
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

After editing Apps Script, deploy a new Web App version. If the Web App URL changes, update `VITE_GOOGLE_APPS_SCRIPT_URL`.
