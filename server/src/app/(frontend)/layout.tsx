import React from 'react'
import './globals.css'

export const metadata = {
  description: 'AnySkin — Beauty & Skincare Product Database',
  title: 'AnySkin',
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const { children } = props

  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, user-scalable=no" />
        {/* Match header bg so iOS/Android status bar blends seamlessly */}
        <meta name="theme-color" content="#fbfafd" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      </head>
      <body className="min-h-[100dvh] bg-background font-sans antialiased overscroll-none select-none [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none]">
        {children}
      </body>
    </html>
  )
}
