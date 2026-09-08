# Train Viewer — Blender 外观对齐

Three.js 单页预览；原始 Blender 与 GLB 文件只读，所有处理输出位于本项目。默认场景使用真实 Blender 相机、材质参数、摄影棚 HDR 和发光节点。

## 使用

在本目录运行 `node tools/serve.mjs`，访问 http://127.0.0.1:4173/ 。任意静态文件服务器也可使用，不能直接双击 HTML。运行时不需要 Node 后端或外部 CDN。

左键旋转，滚轮缩放，右键平移；触屏单指旋转、双指缩放和平移。页面进入时显示 Ant Design `Spin fullscreen percent`，进度对应文件下载和初始化阶段，首帧完成后消失。预览页只有底部居中的 Ant Design 返回按钮，点击平滑恢复 `Camera01_hero`；鼠标可随时接管动画。系统减少动态效果设置会跳过动画。

按用户最新要求，界面改用 React 19.1.1 + Ant Design 5.27.3，替代第一版“不使用 React”的约束。Three.js 固定为 0.180.0，RGBELoader 按原要求保留，因此控制台有官方弃用提示。

## 文件

- `index.html` / `dist/app.js` / `dist/app.css`：可直接静态部署的入口和已打包前端。
- `src/main.jsx`：Ant Design 加载状态、返回按钮和错误恢复。
- `src/viewer.js`：GLB/HDR 加载、固定主相机、OrbitControls、TrainRoot、资源释放。
- `src/appearance.js`：Blender 相机坐标转换、面光源、材质节点近似、Filmic 和抗锯齿。
- `assets/environment.glb`：约 8.3 MB；地面与轨道。
- `assets/default_train.glb`：约 26.2 MB；列车。
- `assets/environment.hdr`：约 23.3 MB；原 Blender 使用的 studio_small_08_8k.hdr 缩至 4K。
- `assets/scene-settings.json`：从 Blender 提取的默认相机、World 和灯光参数。
- `assets/filmic-lut.png`：通过 Blender 生成的 Filmic / Medium High Contrast 显示变换查找表。
- `assets/blender-reference.png`：原场景 Cycles 对照渲染，960×540、24 采样、降噪。
- `assets/blender-reference-no-area.png`：仅用于光照贡献校准的无面光源对照。
- `assets/blender-source.json`：材质节点、相机和 World 的只读检查记录。
- `vendor/three`：Three.js 官方运行模块及许可证。
- `tools`：离线资产处理、构建、回归测试及本地静态服务器。

GitHub Pages 发布保留 `index.html`、`dist`、`assets`、`vendor` 的相对目录结构。诊断用 reference PNG、blender-source.json、asset-report.json 可不发布。当前没有执行 GitHub 发布。

## 本轮修复依据

实际输入：`F:\3D\Samples\3D Preview Sample\CAPTAIN_3D Preview Sample_3_20260908.blend` 及同名 GLB。

1. 原 GLB 未包含相机；直接从 blend 恢复 `Camera01_hero` 的世界变换、25 mm 焦距和 36 mm 传感器。仍由同一个网页 PerspectiveCamera 渲染，预设只修改主相机与 controls.target。窄窗口扩大垂直视角以保留水平构图。
2. 原 World 使用 `studio_small_08_8k.hdr`、强度 0.05、绕 Blender Z 轴旋转 15°，含去饱和及对比度节点。第一版误用了文件夹中的车站 HDR，本版已更换。
3. 灯光为带 UV.Y 渐变的椭圆面光源；灯光 strength 10 与发光节点 900 相乘。用 8 条矩形发光带近似椭圆及渐变，保留原位置和尺度。
4. 从 Blender 节点恢复车漆基色、双层视角变色混合、金属度、粗糙度、清漆和 IOR；玻璃恢复 Glass/Glossy 的视角混合。原 GLB 中只有名称的材质已修复。
5. 恢复原 `.simple_uv_mapping` 的倍率，包括地面 160；反射贴图按 Blender 的 sRGB 设置线性化。
6. 使用 Blender 生成的 64³ 对数查找表近似 Filmic / Medium High Contrast，而非第一版 ACES。采用静态摄影棚阴影代理、GTAO 接触遮蔽、MSAA 和 SMAA 抗锯齿。
7. 车身、侧窗及标识等关键表面不再减面；底盘高密度零件仍使用网页简化副本，Meshopt 压缩。原文件未重存。

坐标为标准 glTF Y-up，Blender Z-up 仅转换一次，米制尺度保持不变。TrainRoot 与 EnvironmentRoot 分离，保留后续列车替换架构，本轮未增加上传功能。

## 视觉边界

本版显著缩小了第一版与 Blender 的差异，但不声称像素级一致。Cycles 是路径追踪；本页是实时 WebGL 光栅化。矩形带面光源配合静态阴影代理，不等同于 Cycles 的完整软阴影；GTAO 是屏幕空间接触遮蔽。玻璃多次折射、场景互反射、复杂微颗粒/污渍节点和部分几何位移仍有差异。查找表、4K HDR 和部分底盘减面也属于近似。未来替换列车后需要设置 `renderer.shadowMap.needsUpdate = true` 更新静态阴影。

原 Blender 对照渲染报告两个未找到的图片引用（`F:\贴图 #78`、`F:\贴图 #88`），未猜测替换。原截图与存盘场景可能存在未保存设置差异；本次以磁盘 blend 作为参数依据。

## 开发与重建

安装 package.json 依赖后运行 `node tools/build.mjs`。打包产物已提供，正常浏览无需安装依赖。执行 `node --test tools/viewer.test.mjs` 验证相机世界变换、动画终点、坐标与窄窗口构图。

资产重建顺序：

1. 用本机 Blender 后台打开原文件，执行 `tools/inspect-blender.py`。
2. `node tools/recover-materials.mjs`。
3. `node --max-old-space-size=8192 tools/prepare-assets.mjs`。
4. `node tools/compress-assets.mjs`。
5. 用 Blender 后台执行 `tools/prepare-color.py`。
6. `node tools/build.mjs`。

离线脚本针对当前场景结构编写；输入换为其他场景时必须先检查根节点、材质和灯光图，不应直接套用节点规则。
