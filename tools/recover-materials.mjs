import fs from 'node:fs';
const source = JSON.parse(fs.readFileSync('assets/blender-source.json'));
const materials = {};
for (const m of source.materials) {
  const nodes = m.tree?.nodes || [], group = nodes.find(n => n.type === 'GROUP');
  const input = (name, fallback) => group?.inputs.find(s => s.name === name)?.value ?? fallback;
  const pbr = (color, metal, roughness) => ({ baseColorFactor: color, metallicFactor: metal, roughnessFactor: roughness });
  const coat = roughness => ({ KHR_materials_clearcoat: { clearcoatFactor: 1, clearcoatRoughnessFactor: roughness }, KHR_materials_ior: { ior: input('ior', input('clearcoat ior', 1.42)) } });
  if (m.name.includes('CARPAINT')) {
    const color = nodes.find(n => n.type === 'RGB')?.outputs[0].value || input('color', input('base layer', [0.1,0.1,0.1,1]));
    materials[m.name] = { pbrMetallicRoughness: pbr(color, 1, input('flakes roughness', input('roughness', 0.3))), extensions: coat(input('clearcoat roughness', group.inputs.filter(s => s.name === 'roughness')[1]?.value ?? 0)), extras: { restoredFromBlender: true, secondaryLayer: input('secondary layer', null), blendFactor: input('blend factor', null) } };
  } else if (m.name === 'GLASS - windshield') {
    materials[m.name] = { pbrMetallicRoughness: pbr(input('color',[1,1,1,1]),0,input('roughness',0.01)), extensions: { KHR_materials_transmission: {transmissionFactor:1}, KHR_materials_ior: {ior:input('ior',1.45)} } };
  } else if (m.name === 'BLACKOUT') materials[m.name] = { pbrMetallicRoughness: pbr([0,0,0,1],0,1) };
  else if (m.name.startsWith('Railtrack_')) {
    const node = nodes.find(n => n.type === 'BSDF_METALLIC');
    materials[m.name] = { pbrMetallicRoughness: pbr(node.inputs.find(s=>s.name==='Base Color').value,1,node.inputs.find(s=>s.name==='Roughness').value) };
  }
}
fs.writeFileSync('tools/recovered-materials.json',JSON.stringify(materials,null,2));
fs.writeFileSync('assets/scene-settings.json',JSON.stringify({camera:{...source.cameras.find(c=>c.name===source.camera),orbitDistance:source.viewports.find(v=>v.screen==='Layout')?.distance},worldStrength:0.05,worldRotation:0.2617993950843811,view:source.view,lights:source.lights},null,2));
