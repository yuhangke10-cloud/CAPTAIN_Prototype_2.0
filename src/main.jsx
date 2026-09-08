import React, { useEffect, useRef, useState, useId } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, Spin, message, theme } from 'antd';
import '@material/web/iconbutton/filled-tonal-icon-button.js';
import '@material/web/button/filled-tonal-button.js';
import { TrainViewer } from './viewer.js';
import './style.css';
const SymbolIcon = ({ name }) => <span className="material-symbols-outlined" aria-hidden="true">{name}</span>;
function ActionButton({ label, disabled, onClick, children }) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return <span className="action-tooltip" onMouseEnter={() => setVisible(true)} onMouseLeave={() => setVisible(false)} onFocus={() => setVisible(true)} onBlur={() => setVisible(false)} onKeyDown={event => { if (event.key === 'Escape') setVisible(false); }}>
    <md-filled-tonal-icon-button disabled={disabled} aria-label={label} aria-describedby={visible ? id : undefined} onClick={() => { setVisible(false); onClick(); }}>{children}</md-filled-tonal-icon-button>
    {visible && !disabled && <span className="md-plain-tooltip" id={id} role="tooltip">{label}</span>}
  </span>;
}
function App() {
  const host = useRef(null), viewer = useRef(null);
  const fileInput = useRef(null);
  const [loading, setLoading] = useState(true), [percent, setPercent] = useState(0), [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [notice, noticeHolder] = message.useMessage();
  const upload = async file => {
    setUploading(true);
    try { await viewer.current.uploadTrain(file); }
    catch (reason) { notice.error(`无法替换列车：${reason.message}`); }
    finally { setUploading(false); }
  };
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
    {noticeHolder}
    <Spin spinning={loading || uploading} percent={uploading ? 'auto' : percent} fullscreen />
    {error ? <div role="alert" className="error"><p>{error}</p><md-filled-tonal-button onClick={() => location.reload()}>重新加载</md-filled-tonal-button></div> : !loading &&
      <div className="viewer-actions" role="group" aria-label="预览操作">
        <input ref={fileInput} type="file" accept=".glb" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) upload(file); }} />
        <ActionButton label="Upload" disabled={uploading} onClick={() => fileInput.current?.click()}><SymbolIcon name="upload" /></ActionButton>
        <ActionButton label="To Camera 01" disabled={uploading} onClick={() => viewer.current?.resetView()}><SymbolIcon name="photo_camera" /></ActionButton>
        <ActionButton label="Default Trainset" disabled={uploading} onClick={() => viewer.current?.resetTrain()}><SymbolIcon name="restart_alt" /></ActionButton>
      </div>}
  </ConfigProvider>;
}
createRoot(document.getElementById('app')).render(<App />);


