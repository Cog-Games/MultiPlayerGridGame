// Add alongside the existing study handler. Keep other study routes unchanged.
const TWO_KIDS_FOLDER_ID = '1j8v13wvo8XLa8dLDBtPxVDV_egBMRHyu';

function isTwoKidsUpload_(p) {
  return p.studyId === 'two-kids' || (!p.protocol && p.filetype === 'excel' &&
    /^experiment_data_[A-Za-z0-9_-]+_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.xlsx$/i.test(p.filename || ''));
}

function saveTwoKids_(p) {
  const lock = LockService.getScriptLock();
  try {
    const filename = String(p.filename || '');
    if (!/^experiment_data_[A-Za-z0-9_-]+\.xlsx$/.test(filename) || filename.length > 250 ||
        p.filetype !== 'excel' || typeof p.filedata !== 'string' || p.filedata.length > 20000000 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(p.filedata)) throw new Error('Invalid two-kids workbook');
    const bytes = Utilities.base64Decode(p.filedata);
    if (bytes[0] !== 80 || bytes[1] !== 75) throw new Error('Expected XLSX workbook');
    // Old clients have no studyId. Validate the actual workbook before routing.
    const zip = Utilities.newBlob(bytes, 'application/zip', 'workbook.zip');
    const parts = Utilities.unzip(zip);
    const canonical = parts.some(part => /^xl\/(sharedStrings.xml|worksheets\/sheet\d+.xml)$/.test(part.getName()) &&
      part.getDataAsString().includes('kids-canonical-events-v1'));
    if (!canonical) throw new Error('Workbook is not a canonical two-kids export');
    const modern = p.protocol === 'two-kids-excel-v1';
    const revision = modern ? Number(p.uploadRevision) : Date.now();
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Invalid upload revision');
    const status = p.snapshot === 'true' ? 'in_progress' : 'completed';
    const sha256 = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)
      .map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
    lock.waitLock(25000);
    const found = Drive.Files.list({
      q: `'${TWO_KIDS_FOLDER_ID}' in parents and trashed = false and name = '${filename}'`,
      fields: 'files(id,name,appProperties),nextPageToken', pageSize: 2
    });
    if ((found.files || []).length > 1 || found.nextPageToken) throw new Error('Duplicate workbook names require review');
    let file = (found.files || [])[0];
    const previous = file?.appProperties || {};
    if (file && previous.twoKidsRevision) {
      if (!modern && previous.twoKidsProtocol === 'two-kids-excel-v1') throw new Error('Update the game before overwriting this session');
      const stored = Number(previous.twoKidsRevision);
      if (revision < stored) throw new Error('A newer workbook is already saved');
      if (revision === stored && sha256 !== previous.twoKidsSha256) throw new Error('Revision content conflict');
      if (previous.twoKidsStatus === 'completed' && status !== 'completed') throw new Error('Completed session cannot be reopened');
    }
    let disposition = 'unchanged';
    if (!file || Number(previous.twoKidsRevision) !== revision) {
      const metadata = { name: filename, mimeType: WORKBOOK_MIME, appProperties: {
        twoKidsRevision: String(revision), twoKidsSha256: sha256, twoKidsStatus: status,
        twoKidsProtocol: modern ? 'two-kids-excel-v1' : 'legacy-canonical'
      } };
      const blob = Utilities.newBlob(bytes, WORKBOOK_MIME, filename);
      if (file) {
        file = Drive.Files.update(metadata, file.id, blob, { fields: 'id,name,appProperties' });
        disposition = 'updated';
      } else {
        metadata.parents = [TWO_KIDS_FOLDER_ID];
        file = Drive.Files.create(metadata, blob, { fields: 'id,name,appProperties' });
        disposition = 'created';
      }
    }
    return jsonResponse_({ status: 'success', protocol: 'two-kids-excel-v1', folderId: TWO_KIDS_FOLDER_ID,
      fileId: file.id, fileName: file.name, sha256, storedRevision: revision, disposition });
  } catch (error) {
    return jsonResponse_({ status: 'error', message: String(error.message || error) });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}
