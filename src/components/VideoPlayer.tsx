import { useEffect, useLayoutEffect, useRef, useState } from "react";

type SafariVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void; webkitDisplayingFullscreen?: boolean; webkitExitFullscreen?: () => void };
const clock = (value: number) => {
  const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/** Mounted synchronously by the preview click so play/fullscreen retain user activation. */
export function VideoPlayer({ src, label, returnFocus, onClose }: { src: string; label: string; returnFocus?: HTMLElement; onClose(): void }) {
  const root = useRef<HTMLDivElement>(null);
  const video = useRef<SafariVideo>(null);
  const [paused, setPaused] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenMessage, setFullscreenMessage] = useState("");
  const [message, setMessage] = useState("Loading video…");
  const [failed, setFailed] = useState(false);
  const finiteDuration = Number.isFinite(duration) && duration > 0;

  function play() {
    const element = video.current;
    if (!element) return;
    setMessage("Loading video…");
    void element.play().catch((error: DOMException) => {
      if (error.name === "AbortError") return;
      setMessage(error.name === "NotAllowedError"
        ? "Playback was blocked by your browser. Press Play to try again."
        : "This video could not play. The source may be unavailable or its format unsupported. Try Retry or Open original in another player.");
    });
  }
  function enterFullscreen() {
    setFullscreenMessage("");
    try {
      if (root.current?.requestFullscreen) {
        void root.current.requestFullscreen().catch(() => setFullscreenMessage("Fullscreen was refused by your browser. You can keep watching here or press Fullscreen to try again."));
      } else if (video.current?.webkitEnterFullscreen) {
        video.current.webkitEnterFullscreen();
      } else {
        setFullscreenMessage("Fullscreen is unavailable in this browser. You can keep watching here or Open original.");
      }
    } catch {
      setFullscreenMessage("Fullscreen is unavailable right now. Keep watching here or press Fullscreen to try again.");
    }
  }
  function exitFullscreen() {
    if (document.fullscreenElement === root.current) void document.exitFullscreen().catch(() => setFullscreenMessage("Use your browser's fullscreen exit control or Escape."));
    else video.current?.webkitExitFullscreen?.();
  }
  function seek(value: number) {
    if (video.current && finiteDuration) {
      const next = Math.max(0, Math.min(duration, value));
      video.current.currentTime = next;
      setTime(next);
    }
  }
  useEffect(() => {
    if (message !== "Loading video…" && message !== "Buffering video…") return;
    const timeout = window.setTimeout(() => setMessage("The video is taking too long to load. Check your connection, try Retry, or Open original."), 15_000);
    return () => window.clearTimeout(timeout);
  }, [message]);
  useLayoutEffect(() => {
    const element = video.current!;
    const container = root.current!;
    const previousFocus = returnFocus ?? document.activeElement as HTMLElement | null;
    const syncFullscreen = () => setFullscreen(document.fullscreenElement === container || !!element.webkitDisplayingFullscreen);
    document.addEventListener("fullscreenchange", syncFullscreen);
    element.addEventListener("webkitbeginfullscreen", syncFullscreen);
    element.addEventListener("webkitendfullscreen", syncFullscreen);
    container.focus();
    // Both requests happen within the original preview click, before awaiting either.
    play();
    enterFullscreen();
    return () => {
      element.pause();
      const restoreFocus = () => { if (previousFocus?.isConnected) previousFocus.focus(); };
      if (document.fullscreenElement === container) void document.exitFullscreen().catch(() => {}).finally(restoreFocus);
      else { if (element.webkitDisplayingFullscreen) element.webkitExitFullscreen?.(); restoreFocus(); }
      document.removeEventListener("fullscreenchange", syncFullscreen);
      element.removeEventListener("webkitbeginfullscreen", syncFullscreen);
      element.removeEventListener("webkitendfullscreen", syncFullscreen);
    };
    // The parent keys this player by source. Do not restart on state updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="canopy-video-player" ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Video player" onKeyDown={(event) => {
    if (event.key === "Tab") {
      const controls = root.current?.querySelectorAll<HTMLElement>('button, input, select, a[href]');
      if (controls?.length) {
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
      return;
    }
    if (event.key === "Escape") {
      event.stopPropagation();
      if (fullscreen) exitFullscreen(); else onClose();
      return;
    }
    if ((event.target as HTMLElement).matches("input, select, button, a")) return;
    if ([" ", "k", "ArrowLeft", "ArrowRight", "m", "f"].includes(event.key)) event.preventDefault();
    if (event.key === " " || event.key === "k") { if (video.current?.paused) play(); else video.current?.pause(); }
    if (event.key === "ArrowLeft") seek(time - 5);
    if (event.key === "ArrowRight") seek(time + 5);
    if (event.key === "m" && video.current) video.current.muted = !video.current.muted;
    if (event.key === "f") { if (fullscreen) exitFullscreen(); else enterFullscreen(); }
  }}>
    <button className="media-viewer-close" type="button" onClick={onClose} aria-label="Close media viewer">×</button>
    <video ref={video} src={src} playsInline preload="metadata" aria-label={label}
      onPlay={() => setPaused(false)} onPause={() => setPaused(true)} onEnded={() => setPaused(true)}
      onPlaying={() => { setMessage(""); setFailed(false); }} onWaiting={() => setMessage("Buffering video…")}
      onLoadedMetadata={() => setDuration(video.current?.duration ?? 0)} onDurationChange={() => setDuration(video.current?.duration ?? 0)}
      onTimeUpdate={() => setTime(video.current?.currentTime ?? 0)}
      onVolumeChange={() => { setVolume(video.current?.volume ?? 1); setMuted(video.current?.muted ?? false); }}
      onRateChange={() => setSpeed(video.current?.playbackRate ?? 1)}
      onError={() => { setFailed(true); setMessage("This video could not load or decode. Its host may be unavailable, access may be blocked, or the format may be unsupported. Try Retry or Open original in another player."); }} />
    <div className="video-transport">
      <label className="video-seek">Seek video<input type="range" min="0" max={finiteDuration ? duration : 0} step="0.1" value={Math.min(time, finiteDuration ? duration : 0)} disabled={!finiteDuration || failed} onChange={event => seek(Number(event.target.value))} aria-valuetext={`${clock(time)} of ${clock(duration)}`} /></label>
      <div className="video-buttons">
        <button type="button" onClick={() => { if (paused) play(); else video.current?.pause(); }}>{paused ? "Play" : "Pause"}</button>
        <output aria-label="Playback time">{clock(time)} / {finiteDuration ? clock(duration) : "—"}</output>
        <button type="button" onClick={() => { if (video.current) video.current.muted = !video.current.muted; }}>{muted ? "Unmute" : "Mute"}</button>
        <label>Volume<input type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume} onChange={event => { if (video.current) { video.current.volume = Number(event.target.value); video.current.muted = false; setVolume(video.current.volume); setMuted(false); } }} /></label>
        <label>Speed<select aria-label="Playback speed" value={speed} onChange={event => { if (video.current) video.current.playbackRate = Number(event.target.value); }}>{[0.5, 0.75, 1, 1.25, 1.5, 2].map(rate => <option key={rate} value={rate}>{rate}×</option>)}</select></label>
        <button type="button" onClick={() => { if (fullscreen) exitFullscreen(); else enterFullscreen(); }}>{fullscreen ? "Exit fullscreen" : "Fullscreen"}</button>
      </div>
      <div className="video-status" role="status" aria-label="Video status">{message}{fullscreenMessage && <p>{fullscreenMessage}</p>}</div>
      <div className="video-links"><button type="button" onClick={() => { setFailed(false); video.current?.load(); play(); }}>Retry</button><a href={src} target="_blank" rel="noopener noreferrer">Open original</a><span>Space/K: play · ←/→: seek · M: mute · F: fullscreen · Esc: exit</span></div>
    </div>
  </div>;
}
