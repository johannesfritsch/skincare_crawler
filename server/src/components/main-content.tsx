'use client'

import { usePathname } from 'next/navigation'

const tabRoots = ['/discover', '/videos', '/products', '/lists', '/profile']

export function MainContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isTabRoot = tabRoots.includes(pathname)

  return (
    <main
      className={`flex-1 flex flex-col min-h-0 ${
        isTabRoot
          ? 'px-4 pt-4 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] standalone-bottom-pad'
          : 'px-4 pt-4 pb-4'
      }`}
    >
      {children}
    </main>
  )
}
