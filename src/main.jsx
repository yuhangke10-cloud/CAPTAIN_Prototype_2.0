import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, ConfigProvider, Spin, theme } from 'antd';
import { TrainViewer } from './viewer.js';
import './style.css';
function App() {
  const host = useRef(null), viewer = useRef(null);
  const [loading, setLoading] = useState(true), [percent, setPercent] = useState(0), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let instance;
    try { instance = new TrainViewer(host.current, {
      onProgress: value => { if (active) setPercent(value); },
      onStatus: (message, failed) => { if (active && failed) setError(message); },
    }); } catch (reason) {
      setError(`无法初始化三维预览：${reason.message}`); setLoading(false); return;
    }
    viewer.current = instance;
    instance.load().then(() => { if (active) { setPercent(100); setLoading(false); } }).catch(reason => {
      console.error(reason);
      instance.dispose();
      if (active) { setError(`场景加载失败：${reason.message}`); setLoading(false); }
    });
    return () => { active = false; instance.dispose(); };
  }, []);
  return <ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: { colorPrimary: '#d4dce4', borderRadius: 24 } }}>
    <main ref={host} className="viewer" aria-label="列车三维预览" />
    <Spin spinning={loading} percent={percent} fullscreen />
    {error ? <div role="alert" className="error"><p>{error}</p><Button onClick={() => location.reload()}>重新加载</Button></div> : !loading &&
      <Button className="return-view" size="large" shape="round" aria-label="返回 Blender 默认视角" onClick={() => viewer.current?.resetView()}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M9 5 3 11l6 6M4 11h11a6 6 0 0 1 6 6v2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        返回
      </Button>}
  </ConfigProvider>;
}
createRoot(document.getElementById('app')).render(<App />);
