// Mosque icon — lucide ships no mosque glyph. Deliberately SIMPLE (user note):
// a pointed onion dome + finial, walls, ground and an arched door. Six strokes,
// lucide visual language (24×24, stroke-2, round caps/joins, currentColor),
// legible down to ~14px.

import { forwardRef, type SVGProps } from "react";

export const MosqueIcon = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(
  function MosqueIcon(props, ref) {
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
      >
        {/* onion dome — two curves meeting in a soft point at the apex */}
        <path d="M6 13c0-3.5 2.6-5 6-7.5 3.4 2.5 6 4 6 7.5" />
        {/* finial */}
        <path d="M12 5.5v-2" />
        {/* walls + ground */}
        <path d="M6 13v8" />
        <path d="M18 13v8" />
        <path d="M4 21h16" />
        {/* arched door */}
        <path d="M10 21v-3a2 2 0 0 1 4 0v3" />
      </svg>
    );
  },
);
