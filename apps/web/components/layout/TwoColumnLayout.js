import Header from './Header';

/**
 * TwoColumnLayout
 * @param {React.ReactNode} left - Editorial/Context content
 * @param {React.ReactNode} right - Functional/Action content
 */
export default function TwoColumnLayout({ left, right }) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 w-full max-w-5xl mx-auto px-6 py-8 grid grid-cols-1 md:grid-cols-12 gap-8">
        {/* Left Column: Editorial/Context */}
        <div className="md:col-span-7 space-y-6">
          {left}
        </div>
        
        {/* Right Column: Functional/Action */}
        <div className="md:col-span-5 space-y-6">
          <div className="sticky top-20">
            {right}
          </div>
        </div>
      </main>
    </div>
  );
}
