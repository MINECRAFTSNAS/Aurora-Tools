import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>

const base = (p: P): P => ({
  width: 16,
  height: 16,
  viewBox: '0 0 21 21',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...p
})

export const IconDownload = (p: P) => (
  <svg {...base(p)}>
    <path d="M10.5 3.5v9.5m0 0 3.5-3.5m-3.5 3.5L7 9.5" />
    <path d="M3.5 14v2a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-2" />
  </svg>
)

export const IconMusic = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 16.5V6.3l8-1.8v10.2" />
    <ellipse cx="6" cy="16.6" rx="2" ry="1.7" />
    <ellipse cx="14" cy="14.9" rx="2" ry="1.7" />
  </svg>
)

export const IconVideo = (p: P) => (
  <svg {...base(p)}>
    <rect x="2.8" y="5" width="11" height="11" rx="2" />
    <path d="M13.8 9.2l3.6-2.1a.7.7 0 0 1 1 .6v5.6a.7.7 0 0 1-1 .6l-3.6-2.1" />
  </svg>
)

export const IconLink = (p: P) => (
  <svg {...base(p)}>
    <path d="M8.4 11.6a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-1 1" />
    <path d="M12.6 9.4a3 3 0 0 0-4.2 0L5.8 12a3 3 0 0 0 4.2 4.2l1-1" />
  </svg>
)

export const IconSearch = (p: P) => (
  <svg {...base(p)}>
    <circle cx="9.5" cy="9.5" r="4.8" />
    <path d="M13.2 13.2 17 17" />
  </svg>
)

export const IconFolder = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 6.2a1.7 1.7 0 0 1 1.7-1.7h3l1.6 1.8h6a1.7 1.7 0 0 1 1.7 1.7v.6" />
    <path d="M3 6.2v9.3a1.7 1.7 0 0 0 1.7 1.7h9.6a1.7 1.7 0 0 0 1.6-1.2l1.7-5.1a1 1 0 0 0-1-1.5H5.4a1.7 1.7 0 0 0-1.6 1.2L3 6.2Z" />
  </svg>
)

export const IconClose = (p: P) => (
  <svg {...base({ ...p, strokeWidth: 1 })}>
    <path d="M5.5 5.5l10 10M15.5 5.5l-10 10" />
  </svg>
)

export const IconMinimize = (p: P) => (
  <svg {...base({ ...p, strokeWidth: 1 })}>
    <path d="M4.5 10.5h12" />
  </svg>
)

export const IconMaximize = (p: P) => (
  <svg {...base({ ...p, strokeWidth: 1 })}>
    <rect x="4.5" y="4.5" width="12" height="12" rx="1.6" />
  </svg>
)

/** 已最大化时的"还原"图标 */
export const IconRestore = (p: P) => (
  <svg {...base({ ...p, strokeWidth: 1 })}>
    <rect x="3.6" y="6.8" width="10.6" height="10.6" rx="1.4" />
    <path d="M6.6 6.8V5.4a1.4 1.4 0 0 1 1.4-1.4h8a1.4 1.4 0 0 1 1.4 1.4v8a1.4 1.4 0 0 1-1.4 1.4h-1.4" />
  </svg>
)

export const IconTrash = (p: P) => (
  <svg {...base(p)}>
    <path d="M4.5 6.5h12M8.5 6.5V4.9a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.6" />
    <path d="M6.4 6.5l.7 9.2a1.4 1.4 0 0 0 1.4 1.3h4a1.4 1.4 0 0 0 1.4-1.3l.7-9.2" />
  </svg>
)

export const IconCheck = (p: P) => (
  <svg {...base(p)}>
    <path d="M4.5 11 8.5 15 16.5 6.5" />
  </svg>
)

export const IconAlert = (p: P) => (
  <svg {...base(p)}>
    <circle cx="10.5" cy="10.5" r="7" />
    <path d="M10.5 6.8v4.4M10.5 14.1v.1" />
  </svg>
)

export const IconInfo = (p: P) => (
  <svg {...base(p)}>
    <circle cx="10.5" cy="10.5" r="7" />
    <path d="M10.5 9.4v4.4M10.5 6.9v.1" />
  </svg>
)

export const IconSettings = (p: P) => (
  <svg {...base(p)}>
    <circle cx="10.5" cy="10.5" r="2.6" />
    <path d="M10.5 2.8v2M10.5 16.2v2M2.8 10.5h2M16.2 10.5h2M5.1 5.1l1.5 1.5M14.4 14.4l1.5 1.5M5.1 15.9l1.5-1.5M14.4 6.6l1.5-1.5" />
  </svg>
)

export const IconLoading = (p: P) => (
  <svg {...base(p)}>
    <path d="M10.5 3.5a7 7 0 1 0 7 7" strokeLinecap="round" />
  </svg>
)

export const IconStop = (p: P) => (
  <svg {...base({ ...p, strokeWidth: 0 })} fill="currentColor">
    <rect x="5" y="5" width="11" height="11" rx="2.2" />
  </svg>
)

export const IconRefresh = (p: P) => (
  <svg {...base(p)}>
    <path d="M16.5 10.5a6 6 0 1 1-1.8-4.3" />
    <path d="M16.5 4.2v3.1h-3.1" />
  </svg>
)

export const IconExternal = (p: P) => (
  <svg {...base(p)}>
    <path d="M11.5 4.5h5v5" />
    <path d="M16.5 4.5 9.8 11.2" />
    <path d="M15 12.5v3a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 5 15.5v-7A1.5 1.5 0 0 1 6.5 7h3" />
  </svg>
)

export const IconInfoCircle = IconInfo

export const IconQueue = (p: P) => (
  <svg {...base(p)}>
    <path d="M3.5 6h14M3.5 10.5h14M3.5 15h9" />
  </svg>
)

export const IconScissors = (p: P) => (
  <svg {...base(p)}>
    <circle cx="5.5" cy="15.5" r="2.3" />
    <circle cx="15.5" cy="15.5" r="2.3" />
    <path d="M7.2 13.6 15 3.5M13.8 13.6 6 3.5" />
  </svg>
)

export const IconChevron = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 8.5l4.5 4.5L15 8.5" />
  </svg>
)

export const IconPlay = (p: P) => (
  <svg {...base({ ...p })} fill="currentColor" stroke="none">
    <path d="M7 4.6a.8.8 0 0 1 1.22-.68l8.1 5.9a.8.8 0 0 1 0 1.36l-8.1 5.9A.8.8 0 0 1 7 16.4V4.6Z" />
  </svg>
)
