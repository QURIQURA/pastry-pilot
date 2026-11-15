import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 2026-11-15 (연): 오더·포뮬러 편집 화면의 SAVE 버튼을 없애고 입력하면 바로 저장되게 한다.
 * (COMPLETED로 바꾸고 SAVE를 깜빡해서 ORDER HISTORY로 안 넘어간 일이 계기)
 *
 * - `snapshot`: 화면의 현재 입력값 전체(JSON 문자열). 바뀔 때마다 `delay` 뒤에 저장한다(텍스트 디바운스).
 * - `immediateKey`: 드롭다운·체크박스처럼 "고르는" 값만 모은 문자열. 이 값이 바뀌면 기다리지 않고 바로 저장한다.
 * - `dirty`: 저장된 값과 다른지(각 화면이 이미 계산하던 값을 그대로 넘긴다).
 * - `saving`: 저장 요청이 진행 중인지. 진행 중에 들어온 입력은 끝난 뒤 이어서 저장한다(요청을 겹치지 않는다).
 * - `save`: 실제 저장 함수. 같은 스냅샷은 한 번만 시도한다 — 실패해도 무한 재시도하지 않고 오류를 보여준 뒤
 *   다음 입력이나 `retry()`에서 다시 시도한다.
 *
 * 페이지를 떠나거나(언마운트) 탭을 숨길 때는 남은 변경을 즉시 저장하고, 저장 전에 창을 닫으려 하면 브라우저 경고를 띄운다.
 */
export function useAutosave({
  snapshot,
  immediateKey = "",
  dirty,
  saving,
  enabled = true,
  delay = 800,
  save,
}: {
  snapshot: string;
  immediateKey?: string;
  dirty: boolean;
  saving: boolean;
  enabled?: boolean;
  delay?: number;
  save: () => void;
}) {
  const saveRef = useRef(save);
  saveRef.current = save;
  const live = useRef({ snapshot, dirty, saving, enabled });
  live.current = { snapshot, dirty, saving, enabled };
  const lastAttempted = useRef<string | null>(null);
  const prevImmediate = useRef(immediateKey);
  const immediatePending = useRef(false);
  const [tick, setTick] = useState(0);

  if (prevImmediate.current !== immediateKey) {
    prevImmediate.current = immediateKey;
    immediatePending.current = true;
  }
  // 서버 재조회로 값이 바뀐 경우처럼 저장할 게 없으면 "바로 저장" 표시를 남기지 않는다.
  if (!dirty) immediatePending.current = false;

  const canFire = () => {
    const s = live.current;
    return s.enabled && s.dirty && !s.saving && s.snapshot !== lastAttempted.current;
  };

  const fire = useCallback(() => {
    if (!canFire()) return;
    immediatePending.current = false;
    lastAttempted.current = live.current.snapshot;
    saveRef.current();
  }, []);

  useEffect(() => {
    if (!canFire()) return;
    const t = setTimeout(fire, immediatePending.current ? 0 : delay);
    return () => clearTimeout(t);
  }, [snapshot, immediateKey, dirty, saving, enabled, delay, tick, fire]);

  // 페이지 이동(언마운트)·탭 숨김 시 디바운스를 기다리지 않고 남은 변경을 저장한다.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") fire();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const s = live.current;
      if (!s.enabled || (!s.dirty && !s.saving)) return;
      fire();
      e.preventDefault();
      e.returnValue = "";
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      fire();
    };
  }, [fire]);

  /** 디바운스를 기다리지 않고 지금 저장(예: 버전 전환 직전). */
  const flush = fire;
  /** 실패한 같은 값을 다시 시도. */
  const retry = useCallback(() => {
    lastAttempted.current = null;
    immediatePending.current = true;
    setTick((n) => n + 1);
  }, []);

  /** 아직 저장 요청을 보내지 않은 입력이 있는지(디바운스 대기 중). */
  const waiting = enabled && dirty && !saving && snapshot !== lastAttempted.current;
  return { flush, retry, waiting };
}
