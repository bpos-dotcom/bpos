"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BPOS_NOTIFICATIONS,
  type BposNotificationKind,
} from "./catalog";

type UseNotificationSoundOptions = {
  active: boolean;
  kind: BposNotificationKind;
};

export function useNotificationSound({
  active,
  kind,
}: UseNotificationSoundOptions) {
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const definition = BPOS_NOTIFICATIONS[kind];

  useEffect(() => {
    const unlock = () => {
      setAudioUnlocked(true);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };

    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });

    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const play = useCallback(async () => {
    if (!audioUnlocked) return;

    try {
      const audio =
        audioRef.current ?? new Audio(definition.soundSrc);

      audioRef.current = audio;
      audio.volume = definition.volume;
      audio.currentTime = 0;
      await audio.play();
    } catch {
      // El navegador puede bloquear audio hasta la primera interacción.
    }
  }, [audioUnlocked, definition.soundSrc, definition.volume]);

  useEffect(() => {
    if (!active || !audioUnlocked) return;

    void play();

    if (!definition.repeat || !definition.repeatEveryMs) {
      return;
    }

    const timer = window.setInterval(
      () => void play(),
      definition.repeatEveryMs
    );

    return () => window.clearInterval(timer);
  }, [active, audioUnlocked, definition.repeat, definition.repeatEveryMs, play]);

  return { play, audioUnlocked };
}
