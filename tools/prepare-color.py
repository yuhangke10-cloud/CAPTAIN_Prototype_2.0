import bpy, math, os, json
root=os.path.dirname(os.path.dirname(__file__))
s=bpy.context.scene
s.view_settings.view_transform='Filmic'
s.view_settings.look='Medium High Contrast'
s.view_settings.exposure=0
s.view_settings.gamma=1
n=64
image=bpy.data.images.new('Filmic display transform',width=n*n,height=n,float_buffer=True)
pixels=[]
for g in range(n):
 for b in range(n):
  for r in range(n):
   pixels.extend([2**(-16+32*r/(n-1)),2**(-16+32*g/(n-1)),2**(-16+32*b/(n-1)),1])
image.pixels.foreach_set(pixels)
s.render.image_settings.file_format='PNG'
s.render.image_settings.color_depth='16'
image.save_render(os.path.join(root,'assets','filmic-lut.png'),scene=s)
hdr=bpy.data.images.load(r'D:\Yuhang Ke\Yuhang Ke_CAD_Databank\Blender_Poliigon Library\HDRI\studio_small_08_8k.hdr')
hdr.scale(4096,2048)
hdr.filepath_raw=os.path.join(root,'assets','environment.hdr')
hdr.file_format='HDR'
hdr.save()
print('COLOR_ASSETS_READY')
