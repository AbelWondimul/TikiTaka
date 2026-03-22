import { useRouter } from 'next/router';
import LiquidMetalHero from '@/components/ui/liquid-metal-hero';
import { ContainerScroll } from '@/components/ui/container-scroll-animation';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import RadialOrbitalTimeline from '@/components/ui/radial-orbital-timeline';
import { FileText, Upload, Zap, BarChart3, MessageSquare } from 'lucide-react';

const LiquidMetal = dynamic(
  () => import('@paper-design/shaders-react').then((mod) => mod.LiquidMetal),
  { ssr: false }
);

import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';

const faqData = [
  {
    question: "What is TikiTaka?",
    answer: "TikiTaka is an AI-powered grading assistant that helps teachers review homework faster, give clearer feedback, and better understand student performance."
  },
  {
    question: "How does TikiTaka work?",
    answer: "Teachers upload student work and grading criteria, and TikiTaka analyzes each submission to suggest scores, feedback, and learning insights for review."
  },
  {
    question: "What features does TikiTaka have?",
    answer: "TikiTaka includes AI-powered PDF grading, inline feedback, precise scoring, homework and quiz management, student response tracking, and class analytics to help teachers save time and spot learning gaps faster."
  },
  {
    question: "Does TikiTaka replace the teacher?",
    answer: "No. TikiTaka supports the grading process, but teachers stay fully in control of final grades, comments, and decisions."
  },
  {
    question: "What assignments can I grade with TikiTaka?",
    answer: "TikiTaka works best for homework, short responses, essays, worksheets, quizzes, and other rubric-based assignments that can be reviewed digitally."
  },
  {
    question: "Can I edit grades and feedback?",
    answer: "Yes. Every suggested score and comment can be reviewed, adjusted, or overridden before anything is finalized."
  },
  {
    question: "How does quiz generation work?",
    answer: "Teachers can create quizzes for a class with a title and description, and student responses are saved so both teachers and students can review past results later."
  },
  {
    question: "What do I need to upload to see how my students are doing in class?",
    answer: "Upload assignments, quizzes, and student submissions so TikiTaka can track performance, highlight learning gaps, and show class-level insights."
  },
  {
    question: "What file formats do you accept for homework and assignment submissions?",
    answer: "TikiTaka currently works best with PDF submissions for homework and assignments."
  }
];

const timelineData = [
  {
    id: 1,
    title: "Upload Rubric",
    date: "Teacher",
    content: "Define scoring guidelines or sync an existing grading criteria PDF.",
    category: "Teacher",
    icon: FileText,
    relatedIds: [3],
    status: "completed" as const,
    energy: 100,
  },
  {
    id: 2,
    title: "Student PDF",
    date: "Student",
    content: "Student uploads response answer PDFs or bundles from Class folders.",
    category: "Student",
    icon: Upload,
    relatedIds: [3],
    status: "completed" as const,
    energy: 100,
  },
  {
    id: 3,
    title: "AI Analysis",
    date: "System",
    content: "Context-aware grading and breakdown execution analysis trigger.",
    category: "AI",
    icon: Zap,
    relatedIds: [1, 2, 4, 5],
    status: "in-progress" as const,
    energy: 85,
  },
  {
    id: 4,
    title: "Gradebook",
    date: "Teacher",
    content: "Review aggregated scores, metrics, and class summaries analytics.",
    category: "Teacher",
    icon: BarChart3,
    relatedIds: [3],
    status: "pending" as const,
    energy: 40,
  },
  {
    id: 5,
    title: "Feedback",
    date: "Student",
    content: "Access point-by-point annotations and study guide review materials.",
    category: "Student",
    icon: MessageSquare,
    relatedIds: [3],
    status: "pending" as const,
    energy: 40,
  },
];

export default function LiquidMetalHeroDemoPage() {
  const router = useRouter();

  const handlePrimaryClick = () => {
    router.push('/login');
  };

  const handleSecondaryClick = () => {
    router.push('/login'); // Or a feature tour
  };

  return (
    <div className="bg-black text-white antialiased overflow-x-hidden dark">
      <LiquidMetalHero
        title="Grade Smarter. Teach Faster."
        subtitle="Say goodbye to piles of paperwork. Upload rubrics and student PDFs to generate instant, context-aware grading and in-depth contextual feedback in seconds."
        primaryCtaLabel="Get Started"
        secondaryCtaLabel="Learn More"
        onPrimaryCtaClick={handlePrimaryClick}
        onSecondaryCtaClick={handleSecondaryClick}
        features={[
          {
            title: "1. Sync Rubric",
            description: "Define your grading criteria or upload an existing scoring guide in seconds."
          },
          {
            title: "2. Upload Response",
            description: "Upload student answer PDFs individually or in mass bundles from class folders."
          },
          {
            title: "3. AI Assessment",
            description: "Receive exact breakdown scores and contextual line-by-line feedback immediately."
          }
        ]}
      />

      <div className="flex flex-col items-center justify-center pt-5 pb-10">
        <ContainerScroll
          titleComponent={<></>}
        >
          <div className="relative h-full w-full overflow-hidden">
            <RadialOrbitalTimeline timelineData={timelineData} />
          </div>
        </ContainerScroll>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-16 border-t border-border mt-10 w-full mb-20">
        <h2 className="text-xl font-medium tracking-tight text-center mb-10 text-foreground">
          Frequently Asked Questions
        </h2>
        <Accordion type="single" collapsible className="w-full">
          {faqData.map((item, index) => (
            <AccordionItem value={`item-${index}`} key={index} className="border-border">
              <AccordionTrigger className="text-left text-base font-medium hover:text-foreground transition-all">
                {item.question}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground text-sm leading-relaxed">
                {item.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </div>
  );
}
