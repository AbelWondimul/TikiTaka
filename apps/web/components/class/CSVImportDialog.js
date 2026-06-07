import { useState, useRef } from 'react';
import Papa from 'papaparse';
import { collection, query, where, getDocs, updateDoc, doc, addDoc, serverTimestamp, arrayUnion } from 'firebase/firestore';
import { db } from '@/firebase';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Upload, Download, CheckCircle, AlertCircle, FileSpreadsheet } from 'lucide-react';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function CSVImportDialog({ open, onOpenChange, classId, className, teacherName, onComplete }) {
  const [step, setStep] = useState('upload'); // 'upload' | 'preview' | 'result'
  const [parsedRows, setParsedRows] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState({ enrolled: 0, invited: 0, invalid: 0 });
  const fileRef = useRef(null);

  const handleDownloadTemplate = () => {
    const csv = 'email,display_name\nstudent@university.edu,Jane Doe\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'student-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const rows = result.data.map(row => ({
          email: (row.email || '').trim().toLowerCase(),
          displayName: (row.display_name || row.displayName || row.name || '').trim(),
          valid: EMAIL_REGEX.test((row.email || '').trim()),
        }));
        setParsedRows(rows);
        setStep('preview');
      },
      error: (err) => {
        console.error('CSV parse error:', err);
      }
    });
  };

  const handleConfirm = async () => {
    setIsProcessing(true);
    let enrolled = 0;
    let invited = 0;
    let invalid = 0;

    const validRows = parsedRows.filter(r => r.valid);

    for (const row of validRows) {
      try {
        // Check if user exists
        const userQ = query(collection(db, 'users'), where('email', '==', row.email));
        const userSnap = await getDocs(userQ);

        if (!userSnap.empty) {
          // User exists — enroll directly
          const uid = userSnap.docs[0].id;
          await updateDoc(doc(db, 'classes', classId), {
            studentIds: arrayUnion(uid)
          });
          enrolled++;
        } else {
          // User doesn't exist — create invite
          await addDoc(collection(db, 'classInvites'), {
            classId,
            className: className || '',
            teacherName: teacherName || '',
            email: row.email,
            displayName: row.displayName,
            status: 'pending',
            createdAt: serverTimestamp(),
          });
          invited++;
        }
      } catch (err) {
        console.error(`Error processing ${row.email}:`, err);
        invalid++;
      }
    }

    invalid += parsedRows.filter(r => !r.valid).length;
    setResults({ enrolled, invited, invalid });
    setStep('result');
    setIsProcessing(false);
  };

  const handleClose = () => {
    setStep('upload');
    setParsedRows([]);
    setResults({ enrolled: 0, invited: 0, invalid: 0 });
    onOpenChange(false);
    if (step === 'result' && onComplete) onComplete();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            Import Students
          </DialogTitle>
          <DialogDescription>Upload a CSV file to enroll students in bulk.</DialogDescription>
        </DialogHeader>

        {step === 'upload' && (
          <div className="space-y-4 py-2">
            <Button variant="outline" className="w-full rounded-xl" onClick={handleDownloadTemplate}>
              <Download className="h-4 w-4 mr-2" /> Download CSV Template
            </Button>
            <div className="border-2 border-dashed rounded-xl p-8 text-center">
              <Upload className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm font-medium">Upload CSV file</p>
              <p className="text-xs text-muted-foreground mt-1">Columns: email, display_name (optional)</p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                className="hidden"
              />
              <Button variant="outline" size="sm" className="mt-4 rounded-lg" onClick={() => fileRef.current?.click()}>
                Select File
              </Button>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{parsedRows.length} students found</span>
              <div className="flex gap-2">
                <Badge className="bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400 border-green-200 dark:border-green-800">
                  {parsedRows.filter(r => r.valid).length} valid
                </Badge>
                {parsedRows.some(r => !r.valid) && (
                  <Badge variant="destructive" className="text-xs">
                    {parsedRows.filter(r => !r.valid).length} invalid
                  </Badge>
                )}
              </div>
            </div>
            <div className="max-h-60 overflow-y-auto border rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-xs">
                    <th className="text-left p-2">Email</th>
                    <th className="text-left p-2">Name</th>
                    <th className="text-center p-2 w-20">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.map((row, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2 text-xs">{row.email}</td>
                      <td className="p-2 text-xs text-muted-foreground">{row.displayName || '—'}</td>
                      <td className="p-2 text-center">
                        {row.valid ? (
                          <CheckCircle className="h-3.5 w-3.5 text-green-600 inline" />
                        ) : (
                          <AlertCircle className="h-3.5 w-3.5 text-destructive inline" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('upload')}>Back</Button>
              <Button onClick={handleConfirm} disabled={isProcessing || parsedRows.filter(r => r.valid).length === 0}>
                {isProcessing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Processing...</> : `Enroll ${parsedRows.filter(r => r.valid).length} Students`}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'result' && (
          <div className="space-y-4 py-4 text-center">
            <CheckCircle className="h-12 w-12 text-green-600 mx-auto" />
            <h3 className="text-lg font-semibold">Import Complete</h3>
            <div className="flex justify-center gap-4">
              {results.enrolled > 0 && (
                <div className="text-center">
                  <p className="text-2xl font-bold text-green-600">{results.enrolled}</p>
                  <p className="text-xs text-muted-foreground">Enrolled</p>
                </div>
              )}
              {results.invited > 0 && (
                <div className="text-center">
                  <p className="text-2xl font-bold text-blue-600">{results.invited}</p>
                  <p className="text-xs text-muted-foreground">Invited</p>
                </div>
              )}
              {results.invalid > 0 && (
                <div className="text-center">
                  <p className="text-2xl font-bold text-red-600">{results.invalid}</p>
                  <p className="text-xs text-muted-foreground">Skipped</p>
                </div>
              )}
            </div>
            <Button onClick={handleClose} className="rounded-xl">Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
