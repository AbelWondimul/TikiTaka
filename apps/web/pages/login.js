import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { auth, db } from '../firebase';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, GraduationCap, BookOpen } from 'lucide-react';
import { doc, setDoc } from 'firebase/firestore';

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

  useEffect(() => {
    // If already logged in, redirect
    if (user && role && !authLoading) {
      router.replace(`/${role}/dashboard`);
    }
  }, [user, role, authLoading, router]);

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
        
        // Update auth profile
        await updateProfile(userCredential.user, { displayName: name });
        
        // Write registration payload with selected role
        await setDoc(doc(db, 'registration_payloads', userCredential.user.uid), {
          displayName: name,
          role: selectedRole,
          timestamp: new Date().toISOString()
        });
        
        // Force token refresh after 4 seconds to pick up the custom claims set by the Cloud Function
        setTimeout(() => {
          userCredential.user.getIdToken(true).then(() => {
            // Re-trigger auth context state update
            router.reload();
          });
        }, 4000);
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
        <title>{isLogin ? 'Login' : 'Register'} - Automated PDF Grading Engine</title>
      </Head>
      <div className="flex flex-col items-center justify-center min-h-screen py-16 px-4 bg-muted/40 text-center select-none">
        <Card className="w-full max-w-sm text-left">
          <CardHeader>
            <CardTitle>{isLogin ? 'Welcome Back' : 'Create an Account'}</CardTitle>
            <CardDescription>
              {isLogin ? 'Enter your credentials to access your dashboard' : 'Sign up to access the grading engine'}
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              
              {!isLogin && (
                <>
                  <div className="space-y-2">
                    <Label>I am a</Label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setSelectedRole('student')}
                        className={cn(
                          'flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-colors',
                          selectedRole === 'student'
                            ? 'border-primary bg-primary/5 text-primary'
                            : 'border-border bg-background text-muted-foreground hover:border-primary/40'
                        )}
                      >
                        <BookOpen className="h-6 w-6" />
                        <span className="text-sm font-medium">Student</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedRole('teacher')}
                        className={cn(
                          'flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-colors',
                          selectedRole === 'teacher'
                            ? 'border-primary bg-primary/5 text-primary'
                            : 'border-border bg-background text-muted-foreground hover:border-primary/40'
                        )}
                      >
                        <GraduationCap className="h-6 w-6" />
                        <span className="text-sm font-medium">Teacher</span>
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="name">Full Name</Label>
                    <Input 
                      id="name" 
                      placeholder="John Doe" 
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required={!isLogin}
                    />
                  </div>
                </>
              )}

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input 
                  id="email" 
                  type="email" 
                  placeholder="m@example.com" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input 
                  id="password" 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>


            </CardContent>
            <CardFooter className="flex flex-col space-y-4">
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isLogin ? 'Sign In' : 'Register'}
              </Button>
              
              <Button 
                type="button" 
                variant="ghost" 
                className="w-full"
                onClick={() => {
                  setIsLogin(!isLogin);
                  setError('');
                }}
              >
                {isLogin ? 'Need an account? Register' : 'Already have an account? Sign In'}
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </>
  );
}
