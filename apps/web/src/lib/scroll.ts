import { useEffect, useRef, useState } from 'react';

/** Hidden while scrolling down, shown again when scrolling up or at the top. */
export function useShowOnScrollUp(): boolean {
  const [show, setShow] = useState(true);
  const last = useRef(0);
  useEffect(() => {
    last.current = window.scrollY;
    const on = () => {
      const y = window.scrollY;
      if (y < 60) setShow(true);
      else if (y > last.current + 8) setShow(false);
      else if (y < last.current - 8) setShow(true);
      last.current = y;
    };
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return show;
}
