import bpy, json, os
from mathutils import Matrix
OUT = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'assets', 'blender-source.json')
def val(v):
    if isinstance(v, (str,int,float,bool)) or v is None: return v
    try: return list(v)
    except: return str(v)
def tree(t, depth=0):
    if not t or depth>5: return None
    nodes=[]
    for n in t.nodes:
        d={'name':n.name,'type':n.type,'label':n.label,'inputs':[{'name':s.name,'value':val(s.default_value) if hasattr(s,'default_value') else None,'linked':s.is_linked} for s in n.inputs]}
        d['outputs']=[{'name':s.name,'value':val(s.default_value) if hasattr(s,'default_value') else None} for s in n.outputs]
        for p in ['blend_type','operation','distribution','interpolation']:
            if hasattr(n,p): d[p]=getattr(n,p)
        if hasattr(n,'image') and n.image: d['image']={'name':n.image.name,'path':bpy.path.abspath(n.image.filepath),'packed':bool(n.image.packed_file),'size':list(n.image.size)}
        if hasattr(n,'node_tree') and n.node_tree: d['group']=tree(n.node_tree,depth+1)
        if hasattr(n,'color_ramp'): d['ramp']=[{'position':e.position,'color':list(e.color)} for e in n.color_ramp.elements]
        nodes.append(d)
    return {'nodes':nodes,'links':[{'from':l.from_node.name,'output':l.from_socket.name,'to':l.to_node.name,'input':l.to_socket.name} for l in t.links]}
s=bpy.context.scene
report={'scene':s.name,'engine':s.render.engine,'world':tree(s.world.node_tree) if s.world else None,'view':{p:val(getattr(s.view_settings,p)) for p in ['view_transform','look','exposure','gamma']},'resolution':[s.render.resolution_x,s.render.resolution_y,s.render.resolution_percentage],'camera':s.camera.name if s.camera else None,'cameras':[],'lights':[],'viewports':[],'materials':[]}
for o in s.objects:
    if o.type=='CAMERA': report['cameras'].append({'name':o.name,'matrix':[list(r) for r in o.matrix_world],'type':o.data.type,'lens':o.data.lens,'angle':o.data.angle,'sensor_width':o.data.sensor_width,'sensor_fit':o.data.sensor_fit,'shift_x':o.data.shift_x,'shift_y':o.data.shift_y})
    if o.type=='LIGHT': report['lights'].append({'name':o.name,'matrix':[list(r) for r in o.matrix_world],'type':o.data.type,'energy':o.data.energy,'color':list(o.data.color),'size':getattr(o.data,'size',None),'shape':getattr(o.data,'shape',None),'normalize':o.data.normalize,'exposure':o.data.exposure,'tree':tree(o.data.node_tree)})
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            space=area.spaces.active;r=space.region_3d
            if r: report['viewports'].append({'screen':screen.name,'perspective':r.view_perspective,'distance':r.view_distance,'location':list(r.view_location),'rotation':list(r.view_rotation),'matrix':[list(row) for row in r.view_matrix.inverted()],'lens':space.lens})
for m in bpy.data.materials:
    if m.users: report['materials'].append({'name':m.name,'diffuse':list(m.diffuse_color),'metallic':m.metallic,'roughness':m.roughness,'tree':tree(m.node_tree)})
with open(OUT,'w',encoding='utf8') as f: json.dump(report,f,ensure_ascii=False,indent=2)
print('INSPECTION_SAVED',OUT,flush=True)
