import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export function useRecording() {
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const recordingInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (recording) {
      recordingInterval.current = setInterval(() => setRecordingTime((t) => t + 1), 1000);
    } else {
      if (recordingInterval.current) clearInterval(recordingInterval.current);
      setRecordingTime(0);
    }
    return () => { if (recordingInterval.current) clearInterval(recordingInterval.current); };
  }, [recording]);

  const recordingTimeLabel = useMemo(() => {
    const m = Math.floor(recordingTime / 60);
    const s = recordingTime % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, [recordingTime]);

  const toggleRecording = useCallback(() => setRecording((prev) => !prev), []);

  return { recording, recordingTimeLabel, toggleRecording };
}
