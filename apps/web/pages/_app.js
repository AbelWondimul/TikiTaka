import { Inter } from "next/font/google";
import "@/styles/globals.css";
import { AuthProvider } from "@/lib/auth-context";

const inter = Inter({ subsets: ["latin"] });

export default function App({ Component, pageProps }) {
  return (
    <AuthProvider>
      <main className={`${inter.className} min-h-screen bg-background font-sans antialiased`}>
        <Component {...pageProps} />
      </main>
    </AuthProvider>
  );
}
