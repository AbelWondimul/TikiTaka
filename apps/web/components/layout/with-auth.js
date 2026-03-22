import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '@/lib/auth-context';
import { Loader2 } from 'lucide-react';

export function withAuth(Component, allowedRole) {
  return function ProtectedRoute(props) {
    const { user, role, loading } = useAuth();
    const router = useRouter();

    useEffect(() => {
      if (!loading) {
        if (!user) {
          router.replace('/login');
        } else if (allowedRole && role !== allowedRole) {
          // Redirect to appropriate dashboard if role mismatch
          router.replace(`/${role}/dashboard`);
        }
      }
    }, [user, role, loading, router]);

    if (loading || !user || (allowedRole && role !== allowedRole)) {
      return (
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      );
    }

    return <Component {...props} />;
  };
}
