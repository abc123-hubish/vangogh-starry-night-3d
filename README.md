# 梵高星夜 · 3D 场景

用 TypeScript、Three.js 和 WebGL 建模的《星月夜》空间。网站只渲染三维场景，不播放参考视频。默认运镜沿参考视频的 39.33 秒时间线穿过村庄、笔触漩涡，并在 18–28 秒靠近月亮。

在线浏览：[GitHub Pages](https://abc123-hubish.github.io/vangogh-starry-night-3d/)。推送到 `main` 后由 GitHub Actions 自动构建并发布。

## 运行

```bash
npm install
npm run dev
```

浏览器打开终端显示的本地地址。`npm run build` 生成 `dist/`。

## 操作

| 模式 | 操作 |
| --- | --- |
| 复刻运镜 | 点击画面右上角“自由游玩”进入三维自由飞行；空格暂停或继续；方向键左右逐帧移动；滚轮调整时间；下方进度条定位帧。 |
| 自由游玩 | WASD 平移；按住鼠标拖动环视；空格上升；Shift 下降；滚轮沿视线前进或后退；R 回到当前运镜位置；Esc 或“返回运镜”退出。触屏设备提供方向和升降按钮。 |

`?t=24&paused=1` 可直接打开第 24 秒的月亮镜头。自由游玩期间运镜时间暂停，退出后按进入前的播放状态继续。

## 素材与复刻范围

- `public/starry-night.jpg`：梵高《星月夜》的公共领域图像，来源：[Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg)，用于采样立体笔触的颜色。
- `reference/reference.mp4`：用户提供的视频副本，只作为本地比对素材，不进入网站构建产物。

三维场景使用程序生成的建筑、地形、柏树、星云笔触和月亮，镜头沿 1180 帧的参考时间轴移动。建模画面仍需通过逐帧视觉比对继续细调，不能等同于原视频的像素级复制。
