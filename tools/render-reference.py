import bpy, os, sys
s=bpy.context.scene
s.render.resolution_percentage=50
s.cycles.samples=24
s.cycles.use_denoising=True
s.render.image_settings.file_format='PNG'
s.render.filepath=os.path.join(os.path.dirname(os.path.dirname(__file__)),'assets','blender-reference.png')
if '--no-area' in sys.argv:
 for o in s.objects:
  if o.type=='LIGHT':o.hide_render=True
 s.render.filepath=s.render.filepath.replace('.png','-no-area.png')
try:
 p=bpy.context.preferences.addons['cycles'].preferences
 p.compute_device_type='OPTIX';p.get_devices()
 for d in p.devices:d.use=d.type!='CPU'
 s.cycles.device='GPU'
except Exception as e:print(e)
bpy.ops.render.render(write_still=True)
