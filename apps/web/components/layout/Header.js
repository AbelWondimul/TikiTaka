import { useAuth } from '@/lib/auth-context';
import { signOut } from 'firebase/auth';
import { auth } from '@/firebase';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { User, LogOut, Bell, Settings, CreditCard } from 'lucide-react';
import Logo from './Logo';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useState } from 'react';

export default function Header() {
  const { user, role } = useAuth();
  const [showProfileDialog, setShowProfileDialog] = useState(false);

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  if (!user) return null;

  return (
    <header className="border-b bg-background/95 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href={role ? `/${role}/dashboard` : "/"} className="hover:opacity-80 transition-opacity">
          <Logo />
        </Link>
        
        {role === 'teacher' && (
          <nav className="hidden md:flex flex-1 items-center justify-center gap-8 font-['Manrope']">
            <Link href="/teacher/dashboard" className="text-[#006b5b] dark:text-[#88f3da] font-bold border-b-2 border-[#006b5b] dark:border-[#88f3da] pb-1">
              Dashboard
            </Link>
            <Link href="#" className="text-slate-500 hover:text-[#006b5b] dark:text-slate-400 dark:hover:text-[#88f3da] font-medium transition-colors pb-1">
              Schedule
            </Link>
            <Link href="#" className="text-slate-500 hover:text-[#006b5b] dark:text-slate-400 dark:hover:text-[#88f3da] font-medium transition-colors pb-1">
              Resources
            </Link>
          </nav>
        )}

        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground">
            <Bell className="h-5 w-5" />
            <span className="absolute top-2.5 right-2.5 h-2 w-2 bg-primary rounded-full border-2 border-background" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Avatar className="h-9 w-9 cursor-pointer border border-border/50 transition-colors hover:border-primary/50">
                <AvatarImage src={user.photoURL} alt={user.displayName} />
                <AvatarFallback className="bg-primary/10 text-primary font-medium">
                  {user.displayName?.charAt(0) || user.email?.charAt(0).toUpperCase() || 'U'}
                </AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">{user.displayName || "User"}</p>
                  <p className="text-xs leading-none text-muted-foreground">
                    {user.email}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => setShowProfileDialog(true)}>
                  <User className="mr-2 h-4 w-4" />
                  <span>Profile</span>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Settings className="mr-2 h-4 w-4" />
                  <span>Settings</span>
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={handleLogout}>
                <LogOut className="mr-2 h-4 w-4" />
                <span>Log out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Dialog open={showProfileDialog} onOpenChange={setShowProfileDialog}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>User Profile</DialogTitle>
                <DialogDescription>
                  Your account details and role.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Name</span>
                  <span className="text-sm font-medium text-foreground">{user.displayName || "N/A"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Email</span>
                  <span className="text-sm text-foreground">{user.email}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Role</span>
                  <Badge variant="outline" className="capitalize">
                    {role}
                  </Badge>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </header>
  );
}
