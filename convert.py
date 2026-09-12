import numpy as np, struct, json, sys, os
import fast_simplification

SRC = r"C:\Users\PC FERRET PRO\Downloads\Meshy_AI_Inky Strut_1789227823_texture.stl"
OUT = sys.argv[1]
TARGET_TRIS = int(sys.argv[2]) if len(sys.argv) > 2 else 90000

# ---- read binary STL ----
raw = np.fromfile(SRC, dtype=np.uint8)
n = struct.unpack('<I', raw[80:84].tobytes())[0]
print("triangles:", n)
body = raw[84:84 + n*50]
tri = body.reshape(n, 50)
verts = np.frombuffer(tri[:, 12:48].tobytes(), dtype='<f4').reshape(n*3, 3).astype(np.float32)

# ---- weld vertices ----
q = np.round(verts.astype(np.float64), 5)
view = np.ascontiguousarray(q).view([('x','f8'),('y','f8'),('z','f8')]).ravel()
uniq, inv = np.unique(view, return_inverse=True)
points = np.stack([uniq['x'], uniq['y'], uniq['z']], axis=1).astype(np.float32)
faces = inv.reshape(-1, 3).astype(np.int32)
# drop degenerate faces
ok = (faces[:,0]!=faces[:,1]) & (faces[:,1]!=faces[:,2]) & (faces[:,0]!=faces[:,2])
faces = faces[ok]
print("welded:", points.shape[0], "verts,", faces.shape[0], "faces")

# ---- decimate ----
reduction = max(0.0, 1.0 - TARGET_TRIS / faces.shape[0])
points, faces = fast_simplification.simplify(points, faces, reduction)
points = points.astype(np.float32); faces = faces.astype(np.uint32)
print("decimated:", points.shape[0], "verts,", faces.shape[0], "faces")

# ---- center + normalize scale (fit in unit-ish box, Y up) ----
mn, mx = points.min(0), points.max(0)
center = (mn + mx) / 2
points -= center
scale = 2.0 / float((mx - mn).max())
points *= scale
print("bbox after:", points.min(0), points.max(0))

# ---- smooth normals (area weighted) ----
p = points[faces]
fn = np.cross(p[:,1]-p[:,0], p[:,2]-p[:,0])
normals = np.zeros_like(points)
for i in range(3):
    np.add.at(normals, faces[:,i], fn)
ln = np.linalg.norm(normals, axis=1, keepdims=True); ln[ln==0] = 1
normals = (normals/ln).astype(np.float32)

# ---- write GLB ----
idx = faces.ravel()
idx_dtype, comp = (np.uint16, 5123) if points.shape[0] < 65536 else (np.uint32, 5125)
idx = idx.astype(idx_dtype)

def pad(b, fill=b'\x00'):
    return b + fill * ((4 - len(b) % 4) % 4)

bpos, bnrm, bidx = points.tobytes(), normals.tobytes(), idx.tobytes()
bins, offs = [], []
o = 0
for b in (bpos, bnrm, bidx):
    offs.append((o, len(b)))
    b = pad(b); bins.append(b); o += len(b)
bin_blob = b''.join(bins)

gltf = {
 "asset": {"version": "2.0", "generator": "stl2glb"},
 "scene": 0, "scenes": [{"nodes": [0]}],
 "nodes": [{"mesh": 0, "name": "InkyStrut"}],
 "meshes": [{"name": "InkyStrut", "primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1}, "indices": 2, "material": 0}]}],
 "materials": [{"name": "Body", "pbrMetallicRoughness": {"baseColorFactor": [0.82,0.82,0.85,1.0], "metallicFactor": 0.15, "roughnessFactor": 0.55}}],
 "buffers": [{"byteLength": len(bin_blob)}],
 "bufferViews": [
   {"buffer":0,"byteOffset":offs[0][0],"byteLength":offs[0][1],"target":34962},
   {"buffer":0,"byteOffset":offs[1][0],"byteLength":offs[1][1],"target":34962},
   {"buffer":0,"byteOffset":offs[2][0],"byteLength":offs[2][1],"target":34963}],
 "accessors": [
   {"bufferView":0,"componentType":5126,"count":int(points.shape[0]),"type":"VEC3",
    "min":points.min(0).tolist(),"max":points.max(0).tolist()},
   {"bufferView":1,"componentType":5126,"count":int(points.shape[0]),"type":"VEC3"},
   {"bufferView":2,"componentType":comp,"count":int(idx.size),"type":"SCALAR"}],
}
jchunk = pad(json.dumps(gltf, separators=(',',':')).encode('utf-8'), b' ')
glb = b'glTF' + struct.pack('<II', 2, 12 + 8 + len(jchunk) + 8 + len(bin_blob))
glb += struct.pack('<I', len(jchunk)) + b'JSON' + jchunk
glb += struct.pack('<I', len(bin_blob)) + b'BIN\x00' + bin_blob
open(OUT, 'wb').write(glb)
print("wrote", OUT, round(len(glb)/1e6, 2), "MB")
