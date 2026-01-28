import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function RtspPanel() {
  const [url, setUrl] = useState("rtsps://stream.skydio.com/demo/Skydio/color");
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [status, setStatus] = useState("idle");
  const pollTimerRef = useRef<number | null>(null);
  const lastObjectUrlRef = useRef<string | null>(null);

  const clearPolling = () => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (lastObjectUrlRef.current) {
      URL.revokeObjectURL(lastObjectUrlRef.current);
      lastObjectUrlRef.current = null;
    }
  };

  const start = async () => {
    setStatus("starting...");
    const res = await window.electron?.startRtsp?.(url);

    if (res?.mjpegUrl) {
      setStatus("warming up...");
      await new Promise((r) => setTimeout(r, 200));
      const latestUrl = res.mjpegUrl.replace("/stream.mjpg", "/latest.jpg");
      const poll = async () => {
        try {
          const response = await fetch(`${latestUrl}?t=${Date.now()}`, { cache: "no-store" });
          if (!response.ok) return;
          const blob = await response.blob();
          const objUrl = URL.createObjectURL(blob);
          if (lastObjectUrlRef.current) {
            URL.revokeObjectURL(lastObjectUrlRef.current);
          }
          lastObjectUrlRef.current = objUrl;
          setFrameUrl(objUrl);
          setStatus("playing");
        } catch {
          setStatus("waiting...");
        }
      };

      clearPolling();
      await poll();
      pollTimerRef.current = window.setInterval(poll, 200);
    } else {
      setStatus("failed");
    }
  };

  const stop = async () => {
    setStatus("stopping...");
    await window.electron?.stopRtsp?.();
    clearPolling();
    setFrameUrl(null);
    setStatus("stopped");
  };

  // stop stream when component unmounts
  useEffect(() => {
    return () => {
      clearPolling();
      window.electron?.stopRtsp?.();
    };
  }, []);

  return (
    <div className="h-full flex flex-col">
      <div className="p-2 flex gap-2 items-center border-b border-border">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} />
        <Button onClick={() => setUrl("rtsps://stream.skydio.com/demo/Skydio/color")}>RGB</Button>
        <Button onClick={() => setUrl("rtsps://stream.skydio.com/demo/Skydio/thermal")}>IR</Button>
        <Button onClick={start}>Start</Button>
        <Button variant="secondary" onClick={stop}>Stop</Button>
      </div>

      <div className="px-2 py-1 text-xs text-muted-foreground">Status: {status}</div>

      <div className="flex-1 bg-black overflow-hidden">
        {frameUrl ? (
          <img
            src={frameUrl}
            className="block h-full w-full object-contain"
            alt="RTSP stream"
            onLoad={() => console.log("[RtspPanel] loaded frame")}
            onError={() => console.error("[RtspPanel] FAILED frame")}
            />


        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            Stream not started
          </div>
        )}
      </div>
    </div>
  );
}
