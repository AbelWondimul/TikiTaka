import { Globe } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Logo({ className }) {
  return (
    <div className={cn("flex items-center gap-2 text-[#181c1c] dark:text-white", className)}>
      <Globe className="h-6 w-6 text-[#006b5b] dark:text-[#88f3da]" />
      <span className="font-bold tracking-tight text-xl">
        <span>Tiki</span>
        <span className="text-[#006b5b] dark:text-[#88f3da]">Taka</span>
      </span>
    </div>
  );
}
