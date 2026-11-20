import React from 'react';

interface MushroomLogoProps {
  className?: string;
}

/**
 * Friendly comic-style mushroom mascot logo for PilzAtlas NRW.
 * Crisp dark ink outlines, warm terracotta cap with cream spots, and a cheerful smiling stem.
 */
export const MushroomLogo: React.FC<MushroomLogoProps> = ({ className = 'h-7 w-7' }) => {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Ground moss shadow */}
      <ellipse cx="20" cy="35.2" rx="11.5" ry="2.6" fill="#2D6A4F" fillOpacity="0.22" />

      {/* Plump cream mushroom stem */}
      <path
        d="M13 21.5 C12.4 26.8 11.6 31.2 13.4 33.4 C15 35.2 25 35.2 26.6 33.4 C28.4 31.2 27.6 26.8 27 21.5 Z"
        fill="#FAF4E8"
      />
      {/* Subtle comic shading on right side of stem */}
      <path
        d="M23.5 21.8 C24.2 26.5 24.4 30.8 23.2 33.8 C25 33.6 26.1 33.1 26.6 32.5 C28.1 30.7 27.4 26.5 26.9 21.8 Z"
        fill="#E9DCC6"
      />
      {/* Stem comic outline */}
      <path
        d="M13 21.5 C12.4 26.8 11.6 31.2 13.4 33.4 C15 35.2 25 35.2 26.6 33.4 C28.4 31.2 27.6 26.8 27 21.5"
        stroke="#132A1E"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Friendly comic face on stem */}
      {/* Rosy cheeks */}
      <ellipse cx="14.6" cy="28.3" rx="1.8" ry="1.05" fill="#F29B8F" fillOpacity="0.75" />
      <ellipse cx="25.4" cy="28.3" rx="1.8" ry="1.05" fill="#F29B8F" fillOpacity="0.75" />
      {/* Eyes with bright comic catchlights */}
      <circle cx="16.8" cy="26.2" r="1.5" fill="#132A1E" />
      <circle cx="16.3" cy="25.7" r="0.5" fill="#FFFFFF" />
      <circle cx="23.2" cy="26.2" r="1.5" fill="#132A1E" />
      <circle cx="22.7" cy="25.7" r="0.5" fill="#FFFFFF" />
      {/* Cheerful little smile */}
      <path
        d="M17.8 28.4 Q20 30.7 22.2 28.4"
        stroke="#132A1E"
        strokeWidth="1.75"
        strokeLinecap="round"
        fill="none"
      />

      {/* Mushroom underside rim */}
      <ellipse cx="20" cy="21.4" rx="13.8" ry="3.2" fill="#EBDAC0" stroke="#132A1E" strokeWidth="2.2" />

      {/* Warm comic mushroom cap */}
      <path
        d="M5.2 19.6 C5.2 9.4 11.4 4.6 20 4.6 C28.6 4.6 34.8 9.4 34.8 19.6 C34.8 21.7 28.6 22.1 20 22.1 C11.4 22.1 5.2 21.7 5.2 19.6 Z"
        fill="#D95D2E"
      />
      {/* Cap comic shadow band on right curve */}
      <path
        d="M27.6 7.2 C31.6 9.8 34.2 14.1 34.2 19.4 C34.2 20.6 31.4 21.3 26.8 21.6 C29.8 19.2 30.2 12.2 27.6 7.2 Z"
        fill="#BF471E"
      />
      {/* Soft top-left comic highlight arc */}
      <path
        d="M9.6 13.8 C10.8 9.8 14 7.5 17.6 6.9"
        stroke="#F6AA7A"
        strokeWidth="2"
        strokeLinecap="round"
      />

      {/* Playful cream comic spots */}
      <ellipse
        cx="13.8"
        cy="13.8"
        rx="2.9"
        ry="2.3"
        transform="rotate(-16 13.8 13.8)"
        fill="#FFF9F0"
        stroke="#132A1E"
        strokeWidth="1.4"
      />
      <ellipse
        cx="25.8"
        cy="13.2"
        rx="2.6"
        ry="2.1"
        transform="rotate(14 25.8 13.2)"
        fill="#FFF9F0"
        stroke="#132A1E"
        strokeWidth="1.4"
      />
      <circle
        cx="20.4"
        cy="9.2"
        r="1.75"
        fill="#FFF9F0"
        stroke="#132A1E"
        strokeWidth="1.35"
      />
      <circle
        cx="29.6"
        cy="17.8"
        r="1.35"
        fill="#FFF9F0"
        stroke="#132A1E"
        strokeWidth="1.25"
      />

      {/* Crisp comic cap outline */}
      <path
        d="M5.2 19.6 C5.2 9.4 11.4 4.6 20 4.6 C28.6 4.6 34.8 9.4 34.8 19.6 C34.8 21.7 28.6 22.1 20 22.1 C11.4 22.1 5.2 21.7 5.2 19.6 Z"
        stroke="#132A1E"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Tiny comic grass tufts at base */}
      <path
        d="M11 34.4 L9.2 31.4 M12.2 34.6 L11.5 32.1"
        stroke="#1B4332"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <path
        d="M29 34.4 L30.8 31.6"
        stroke="#1B4332"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
};
