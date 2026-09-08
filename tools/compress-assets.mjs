import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const report = JSON.parse(fs.readFileSync('assets/asset-report.json'));
for (const output of report.outputs) {
  const doc = await io.read(output.filename);
  await doc.transform(prune(), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 16, quantizeNormal: 12, quantizeTexcoord: 14 }));
  await io.write(output.filename, doc);
  output.bytesBeforeCompression = output.bytes;
  output.bytes = fs.statSync(output.filename).size;
  console.log(output.filename, output.bytes);
}
fs.writeFileSync('assets/asset-report.json', JSON.stringify(report, null, 2));
