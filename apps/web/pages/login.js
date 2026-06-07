import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth, db } from '../firebase';
import { useAuth } from '@/lib/auth-context';
import { Loader2 } from 'lucide-react';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import Logo from '@/components/layout/Logo';
import { cn } from '@/lib/utils';

export default function Login() {
  const router = useRouter();
  const { user, role, loading: authLoading } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [selectedRole, setSelectedRole] = useState('student');
  const [inviteToken, setInviteToken] = useState('');

  useEffect(() => {
    // If already logged in, redirect
    if (user && role && !authLoading) {
      router.replace(`/${role}/dashboard`);
    }
  }, [user, role, authLoading, router]);

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const googleUser = result.user;

      // Check if user already exists in Firestore
      const userDoc = await getDoc(doc(db, 'users', googleUser.uid));
      if (!userDoc.exists()) {
        // New user — write registration payload with selected role
        await setDoc(doc(db, 'registration_payloads', googleUser.uid), {
          displayName: googleUser.displayName || googleUser.email,
          role: selectedRole,
          inviteToken: selectedRole === 'teacher' ? inviteToken : undefined,
          timestamp: new Date().toISOString(),
        });

        // Wait for onUserCreate to process
        setTimeout(() => {
          googleUser.getIdToken(true).then(() => {
            router.reload();
          });
        }, 6000);
      }
      // Existing user — useEffect will redirect
    } catch (err) {
      console.error(err);
      if (err.code !== 'auth/popup-closed-by-user') {
        setError(err.message || 'Google sign-in failed. Please try again.');
      }
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
        // On success, useEffect redirects
      } else {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCredential.user, { displayName: name });
        await setDoc(doc(db, 'registration_payloads', userCredential.user.uid), {
          displayName: name,
          role: selectedRole,
          inviteToken: selectedRole === 'teacher' ? inviteToken : undefined,
          timestamp: new Date().toISOString()
        });
        
        setTimeout(() => {
          userCredential.user.getIdToken(true).then(() => {
            router.reload();
          });
        }, 6000);
      }
    } catch (err) {
      console.error(err);
      setError(err.message || 'Authentication failed. Please check your credentials.');
      setLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>{isLogin ? 'Sign In' : 'Join'} - TikiTaka AI</title>
      </Head>
      <div className="flex flex-col min-h-screen bg-background text-foreground">
        
        {/* TopNavBar */}
        <header className="w-full top-0 sticky z-50 bg-background/95 backdrop-blur-sm border-b border-border">
          <div className="flex justify-between items-center px-6 md:px-12 py-6 max-w-[1440px] mx-auto">
            
            {/* The standard green/black Logo is here as requested */}
            <Link href="/" className="hover:opacity-80 transition-opacity">
              <Logo className="scale-110" />
            </Link>

            <nav className="hidden md:flex items-center gap-8 tracking-tight">
            </nav>
            <div className="flex items-center gap-6 tracking-tight">
              <button 
                onClick={() => setIsLogin(true)}
                className={cn(
                  "opacity-80 hover:text-primary dark:hover:text-primary transition-colors duration-300",
                  isLogin ? "text-primary font-semibold dark:text-primary" : "text-foreground dark:text-muted-foreground"
                )}
              >
                Sign In
              </button>
              <button 
                onClick={() => setIsLogin(false)}
                className={cn(
                  "font-semibold hover:scale-95 transition-transform duration-200",
                  !isLogin ? "text-primary dark:text-primary border-b-2 border-primary pb-0.5" : "text-foreground dark:text-muted-foreground opacity-80"
                )}
              >
                Sign Up
              </button>
            </div>
          </div>
        </header>

        {/* Main Content Canvas */}
        <main className="flex-grow flex items-center justify-center px-6 py-20">
          <div className="w-full max-w-lg bg-card rounded-xl shadow-sm dark:border border-border overflow-hidden">
            <div className="p-10 md:p-14">
              
              {/* Header & Toggle */}
              <div className="text-center mb-10">
                <h1 className="text-2xl font-semibold text-foreground tracking-tight mb-4">
                  {isLogin ? 'Welcome Back' : 'Join TikiTaka'}
                </h1>
                <p className="text-muted-foreground text-sm mb-8">
                  {isLogin ? 'Sign in to access your dashboard.' : 'Start your journey into precision pedagogy.'}
                </p>
                
                {/* Toggle Switch */}
                <div className="inline-flex bg-[#f1f4f3] dark:bg-slate-800 p-1.5 rounded-full">
                  <button 
                    onClick={() => { setIsLogin(true); setError(''); }}
                    className={cn(
                      "px-6 py-2 text-xs font-semibold tracking-widest uppercase rounded-full transition-all duration-300",
                      isLogin ? "bg-[#ffffff] dark:bg-slate-700 text-[#006b5b] dark:text-[#88f3da] shadow-sm" : "text-[#41474e] dark:text-slate-400 hover:text-[#003b5a]"
                    )}
                  >
                    Sign In
                  </button>
                  <button 
                    onClick={() => { setIsLogin(false); setError(''); }}
                    className={cn(
                      "px-6 py-2 text-xs font-semibold tracking-widest uppercase rounded-full transition-all duration-300",
                      !isLogin ? "bg-[#ffffff] dark:bg-slate-700 text-[#006b5b] dark:text-[#88f3da] shadow-sm" : "text-[#41474e] dark:text-slate-400 hover:text-[#003b5a]"
                    )}
                  >
                    Sign Up
                  </button>
                </div>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-6">
                {error && (
                  <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 p-3 rounded-lg text-xs font-medium border border-red-100 dark:border-red-900">
                    {error}
                  </div>
                )}

                {!isLogin && (
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-bold tracking-widest uppercase text-[#41474e] dark:text-slate-400 px-1" htmlFor="name">Full Name</label>
                    <div className="relative">
                      <input 
                        id="name" 
                        type="text"
                        placeholder="Alex Rivers" 
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required={!isLogin}
                        className="w-full bg-[#e0e3e2] dark:bg-slate-800 border-0 border-b-2 border-transparent focus:border-[#003b5a] dark:focus:border-[#88f3da] focus:ring-0 px-4 py-3.5 text-[#181c1c] dark:text-white placeholder:text-[#72787f] dark:placeholder:text-slate-500 transition-all duration-300 rounded-t-lg outline-none"
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="block text-[11px] font-bold tracking-widest uppercase text-[#41474e] dark:text-slate-400 px-1" htmlFor="email">Email Address</label>
                  <div className="relative">
                    <input 
                      id="email" 
                      type="email"
                      placeholder="alex@tikitaka.ai" 
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="w-full bg-[#e0e3e2] dark:bg-slate-800 border-0 border-b-2 border-transparent focus:border-[#003b5a] dark:focus:border-[#88f3da] focus:ring-0 px-4 py-3.5 text-[#181c1c] dark:text-white placeholder:text-[#72787f] dark:placeholder:text-slate-500 transition-all duration-300 rounded-t-lg outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[11px] font-bold tracking-widest uppercase text-[#41474e] dark:text-slate-400 px-1" htmlFor="password">Password</label>
                  <div className="relative">
                    <input 
                      id="password" 
                      type="password"
                      placeholder="••••••••" 
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="w-full bg-[#e0e3e2] dark:bg-slate-800 border-0 border-b-2 border-transparent focus:border-[#003b5a] dark:focus:border-[#88f3da] focus:ring-0 px-4 py-3.5 text-[#181c1c] dark:text-white placeholder:text-[#72787f] dark:placeholder:text-slate-500 transition-all duration-300 rounded-t-lg outline-none"
                    />
                  </div>
                </div>

                {!isLogin && (
                  <div className="pt-2 space-y-4">
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-bold tracking-widest uppercase text-[#41474e] dark:text-slate-400 px-1">I am a</label>
                      <select
                        value={selectedRole}
                        onChange={(e) => { setSelectedRole(e.target.value); setInviteToken(''); }}
                        className="w-full bg-[#e0e3e2] dark:bg-slate-800 border-0 border-b-2 border-transparent focus:border-[#003b5a] dark:focus:border-[#88f3da] focus:ring-0 px-4 py-3.5 text-[#181c1c] dark:text-white transition-all duration-300 rounded-t-lg outline-none"
                      >
                        <option value="student">Student</option>
                        <option value="teacher">Teacher</option>
                      </select>
                    </div>
                    {selectedRole === 'teacher' && (
                      <div className="space-y-1.5">
                        <label className="block text-[11px] font-bold tracking-widest uppercase text-[#41474e] dark:text-slate-400 px-1">Teacher Invite Code</label>
                        <input
                          type="password"
                          placeholder="Enter your invite code"
                          value={inviteToken}
                          onChange={(e) => setInviteToken(e.target.value)}
                          required={selectedRole === 'teacher'}
                          className="w-full bg-[#e0e3e2] dark:bg-slate-800 border-0 border-b-2 border-transparent focus:border-[#003b5a] dark:focus:border-[#88f3da] focus:ring-0 px-4 py-3.5 text-[#181c1c] dark:text-white placeholder:text-[#72787f] dark:placeholder:text-slate-500 transition-all duration-300 rounded-t-lg outline-none"
                        />
                      </div>
                    )}
                  </div>
                )}

                <div className="pt-6">
                  <button 
                    type="submit" 
                    disabled={loading}
                    className="w-full flex justify-center bg-primary text-primary-foreground py-4 px-6 rounded-lg font-medium tracking-tight hover:brightness-110 active:scale-95 transition-all duration-200"
                  >
                    {loading && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                    {isLogin ? 'Sign In' : 'Create Account'}
                  </button>
                </div>

                <div className="relative py-4">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-border"></div>
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-card px-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">or</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-3 bg-card border border-border py-3.5 px-6 rounded-lg font-semibold text-sm text-foreground hover:bg-muted active:scale-95 transition-all duration-200"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Continue with Google
                </button>

                {!isLogin && (
                  <p className="text-center text-[10px] text-[#72787f] dark:text-slate-500 mt-2">
                    Google sign-up will use the role selected above ({selectedRole}).
                  </p>
                )}

                <p className="text-center text-[10px] text-[#72787f] dark:text-slate-500 px-4 font-['Inter'] leading-relaxed">
                  By signing {isLogin ? 'in' : 'up'}, you agree to our Terms of Service and Privacy Policy. Data processed by TikiTaka AI.
                </p>
              </form>
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="w-full border-t-0 bg-[#f7faf9] dark:bg-slate-950">
          <div className="bg-[#f1f4f3] dark:bg-slate-800 h-px w-full mb-8"></div>
          <div className="flex flex-col items-center justify-center py-12 px-6 w-full text-center">
            <p className="font-['Inter'] text-xs tracking-widest uppercase text-[#003b5a] dark:text-slate-400 mb-6">
              © 2026 Tiki Taka AI. Precision in Pedagogy.
            </p>
            <div className="flex flex-wrap justify-center gap-8 font-['Inter'] text-xs tracking-widest uppercase">
              <span className="text-slate-500">Privacy Policy</span>
              <span className="text-slate-500">Terms of Service</span>
            </div>
          </div>
        </footer>

      </div>
    </>
  );
}
