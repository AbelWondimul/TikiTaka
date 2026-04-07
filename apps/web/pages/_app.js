import { useEffect } from "react";
import { Inter } from "next/font/google";
import "@/styles/globals.css";
import 'katex/dist/katex.min.css';
import { AuthProvider } from "@/lib/auth-context";
import { ToastProvider } from "@/components/ui/toast-provider";

const inter = Inter({ subsets: ["latin"] });

export default function App({ Component, pageProps }) {
  // Dark mode: read from localStorage on mount
  useEffect(() => {
    const theme = localStorage.getItem('tikitaka-theme');
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, []);

  return (
    <AuthProvider>
      <ToastProvider>
        <main className={`${inter.className} min-h-screen bg-background font-sans antialiased`}>
          <Component {...pageProps} />
        </main>
      </ToastProvider>
    </AuthProvider>
  );
}
