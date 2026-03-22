import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { collection, addDoc, query, where, getDocs } from 'firebase/firestore';

import { db } from '@/firebase';
import { useAuth } from '@/lib/auth-context';
import { generateClassCode } from '@/lib/classUtils';
import { withAuth } from '@/components/layout/with-auth';
import Header from '@/components/layout/Header';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Loader2, Plus, Users } from 'lucide-react';

const formSchema = z.object({
  name: z.string().min(2, { message: "Class name must be at least 2 characters." }),
});

function TeacherDashboard() {
  const { user } = useAuth();
  const [classes, setClasses] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newlyCreatedClassCode, setNewlyCreatedClassCode] = useState(null);

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
    },
  });

  const fetchClasses = async () => {
    if (!user) return;
    try {
      setIsLoading(true);
      const q = query(collection(db, 'classes'), where('teacherId', '==', user.uid));
      const querySnapshot = await getDocs(q);
      const fetchedClasses = [];
      querySnapshot.forEach((doc) => {
        fetchedClasses.push({ id: doc.id, ...doc.data() });
      });
      setClasses(fetchedClasses);
    } catch (error) {
      console.error("Error fetching classes:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchClasses();
  }, [user]);

  async function onSubmit(values) {
    if (!user) return;
    try {
      const classCode = generateClassCode();
      const newClassData = {
        teacherId: user.uid,
        name: values.name,
        classCode: classCode,
        studentIds: [],
        createdAt: new Date(),
      };

      await addDoc(collection(db, 'classes'), newClassData);
      
      form.reset();
      setNewlyCreatedClassCode(classCode);
      fetchClasses(); // Refresh the list
    } catch (error) {
      console.error("Error creating class:", error);
    }
  }

  return (
    <>
      <Head>
        <title>Teacher Dashboard - Automated PDF Grading Engine</title>
      </Head>
      <Header />
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">


        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            My Classes
          </h1>
          <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => setNewlyCreatedClassCode(null)}>
                <Plus className="mr-2 h-4 w-4" /> Create New Class
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Create New Class</DialogTitle>
                <DialogDescription>
                  Enter a name for your new class. A unique joining code will be generated.
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Class Name</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. CS 101, Fall Biology" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <DialogFooter>
                    <Button type="submit" disabled={form.formState.isSubmitting}>
                      {form.formState.isSubmitting ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Creating...
                        </>
                      ) : (
                        "Create Class"
                      )}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
              
              {newlyCreatedClassCode && (
                <div className="mt-4 p-4 bg-muted rounded-lg text-center border">
                  <p className="text-sm font-medium text-foreground mb-2">Class created successfully!</p>
                  <p className="text-sm text-muted-foreground mb-1">Share this code with your students:</p>
                  <p className="text-2xl font-mono tracking-widest font-bold text-primary">{newlyCreatedClassCode}</p>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>
        
        {isLoading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="animate-pulse bg-muted/50 h-40" />
            ))}
          </div>
        ) : classes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center bg-card rounded-xl border border-dashed">
            <Users className="h-10 w-10 text-muted-foreground mb-4" />
            <p className="text-sm font-medium text-foreground">No classes yet</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              Create your first class to generate a joining code and invite your students.
            </p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {classes.map((c) => (
              <Card key={c.id} className="flex flex-col">
                <CardHeader>
                  <CardTitle className="text-base font-medium">{c.name}</CardTitle>
                  <CardDescription>Code: <span className="font-mono font-medium text-foreground">{c.classCode}</span></CardDescription>
                </CardHeader>
                <CardContent className="flex-1">
                  <div className="flex items-center text-sm text-muted-foreground">
                    <Users className="mr-2 h-4 w-4" />
                    {c.studentIds ? c.studentIds.length : 0} enrolled
                  </div>
                </CardContent>
                <CardFooter>
                  <Button variant="outline" className="w-full" asChild>
                    <a href={`/teacher/class/${c.id}`}>Manage Class</a>
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export default withAuth(TeacherDashboard, 'teacher');
