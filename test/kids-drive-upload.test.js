import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { uploadKidsWorkbook, TWO_KIDS_FOLDER_ID } from '../server/kidsDriveUpload.js';

const filename = 'experiment_data_UPLOAD_TEST_default_00000000-0000-4000-8000-000000000001.xlsx';
const bytes = Buffer.from('PK synthetic transport fixture');
const filedata = bytes.toString('base64');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const body = { filename, filedata, uploadRevision: 10, snapshot: true };
const receipt = { status: 'success', protocol: 'two-kids-excel-v1', folderId: TWO_KIDS_FOLDER_ID,
  fileName: filename, fileId: 'test-id', sha256, storedRevision: 10 };

test('server only confirms matching provider folder, content, filename and revision', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = options.body;
    return { ok: true, json: async () => receipt };
  };
  assert.deepEqual(await uploadKidsWorkbook(body, { fetchImpl }), receipt);
  assert.equal(request.get('studyId'), 'two-kids');
  for (const patch of [{ status: 'error', message: 'Invalid session upload' }, { folderId: 'other-study' },
    { sha256: 'incorrect' }, { storedRevision: 11 }, { fileName: 'other.xlsx' }]) {
    await assert.rejects(uploadKidsWorkbook(body, { fetchImpl: async () => ({ ok: true, json: async () => ({ ...receipt, ...patch }) }) }));
  }
  await assert.rejects(uploadKidsWorkbook({ ...body, filedata: 'bm90LXhsc3g=' }, { fetchImpl }));
});

function provider() {
  let file, writes = 0, query;
  const context = {
    WORKBOOK_MIME: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    jsonResponse_: x => x,
    LockService: { getScriptLock: () => ({ waitLock() {}, hasLock: () => true, releaseLock() {} }) },
    Utilities: {
      base64Decode: value => [...Buffer.from(value, 'base64')],
      newBlob: value => value,
      unzip: () => [{ getName: () => 'xl/worksheets/sheet1.xml', getDataAsString: () => 'kids-canonical-events-v1' }],
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (_, value) => [...createHash('sha256').update(Buffer.from(value)).digest()]
    },
    Drive: { Files: {
      list: options => { query = options.q; return { files: file ? [file] : [] }; },
      create: metadata => { writes++; file = { ...metadata, id: 'same-id' }; return file; },
      update: (metadata, id) => { writes++; assert.equal(id, file.id); file = { ...file, ...metadata }; return file; }
    } }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(new URL('../scripts/two-kids-drive-handler.gs', import.meta.url), 'utf8'), context);
  return { context, write: p => context.saveTwoKids_({ filetype: 'excel', protocol: 'two-kids-excel-v1',
    studyId: 'two-kids', filename, filedata, snapshot: 'true', uploadRevision: '10', ...p }),
    get file() { return file; }, get writes() { return writes; }, get query() { return query; } };
}

test('Drive upsert preserves ID, identical retries do not duplicate and older snapshots cannot overwrite', () => {
  const p = provider();
  const first = p.write(); assert.equal(first.status, 'success');
  assert.equal(p.file.parents[0], TWO_KIDS_FOLDER_ID);
  assert(p.query.includes(TWO_KIDS_FOLDER_ID));
  assert.equal(p.write().disposition, 'unchanged'); assert.equal(p.writes, 1);
  assert.equal(p.write({ uploadRevision: '11', snapshot: 'false' }).fileId, first.fileId);
  assert.equal(p.writes, 2);
  assert.equal(p.write({ uploadRevision: '9' }).status, 'error');
  assert.equal(p.write({ uploadRevision: '12', snapshot: 'true' }).status, 'error');
  assert.equal(p.writes, 2);
});

test('legacy two-kids routing requires its filename and workbook schema; other studies stay separate', () => {
  const p = provider();
  assert(p.context.isTwoKidsUpload_({ filename, filetype: 'excel' }));
  assert(!p.context.isTwoKidsUpload_({ filename: 'cake_kid_test.xlsx', protocol: 'cake-session-upsert-v1' }));
  assert.equal(p.write({ protocol: undefined }).status, 'success');
  p.context.Utilities.unzip = () => [{ getName: () => 'xl/sharedStrings.xml', getDataAsString: () => 'other-study' }];
  assert.equal(p.write({ uploadRevision: '12' }).status, 'error');
});
