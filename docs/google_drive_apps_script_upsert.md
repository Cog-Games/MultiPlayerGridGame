# Google Drive Apps Script Upsert Endpoint

The kids flow can upload the same Excel workbook name after DOB, after each trial, after questionnaire, and at final save. To avoid duplicate files, the Apps Script endpoint should replace the existing file when `upsert=true`.

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

    if (filetype === "json") {
      const filename = e.parameter.filename || `checkpoint_${timestamp}.json`;
      const filedata = e.parameter.filedata;

      if (!filedata) {
        throw new Error("No JSON checkpoint data received");
      }

      const jsonText = Utilities.newBlob(
        Utilities.base64Decode(filedata)
      ).getDataAsString("UTF-8");

      const file = folder.createFile(
        Utilities.newBlob(jsonText, "application/json", filename)
      );

      return jsonResponse({
        status: "success",
        message: "JSON checkpoint saved successfully",
        fileId: file.getId(),
        fileName: filename,
        folderName,
        checkpoint: e.parameter.checkpoint || "",
        eventType: e.parameter.eventType || "",
        sessionId: e.parameter.sessionId || "",
        sequenceNumber: e.parameter.sequenceNumber || "",
        participantId: e.parameter.participantId || ""
      });
    }

    const csvContent = e.postData && e.postData.contents;
    const fileName = `data_${timestamp}.csv`;

    if (!csvContent) {
      throw new Error("No CSV data received");
    }

    const file = folder.createFile(fileName, csvContent, MimeType.CSV);

    return jsonResponse({
      status: "success",
      message: "CSV file saved successfully",
      fileId: file.getId(),
      fileName,
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
