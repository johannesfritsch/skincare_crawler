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
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body className="min-h-screen bg-background font-sans antialiased">
        {children}
      </body>
    </html>
  )
}
