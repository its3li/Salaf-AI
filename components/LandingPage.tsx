import React from 'react';

interface LandingPageProps {
  onStartChat: () => void;
  onInstallClick: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onStartChat, onInstallClick }) => {
  return (
    <div className="min-h-screen w-full flex flex-col relative overflow-hidden bg-[#0a0a0a]">
      {/* Background Ambience */}
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none z-0">
        <div className="absolute top-[-10%] right-[-5%] w-[500px] h-[500px] bg-[#D4AF37]/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[600px] h-[600px] bg-[#D4AF37]/5 rounded-full blur-[100px]" />
      </div>

      {/* Navigation */}
      <nav className="relative z-10 w-full px-6 py-6 md:px-12 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <img 
            src="https://i.postimg.cc/RhRmHpj2/1000000424.png" 
            alt="Salaf AI Logo" 
            width="48"
            height="48"
            className="h-12 w-auto object-contain drop-shadow-[0_0_15px_rgba(212,175,55,0.2)]"
          />
          <span className="text-xl font-bold text-[#E0E0E0] tracking-wider">Salaf AI</span>
        </div>
        <div className="flex items-center gap-6">
          <button 
            onClick={onStartChat}
            className="px-6 py-2 rounded-full border border-[#D4AF37]/30 text-[#D4AF37] hover:bg-[#D4AF37] hover:text-[#121212] transition-all duration-300 text-sm font-semibold"
          >
            الدخول للتطبيق
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center text-center px-4 pb-20 pt-10">
        <div className="animate-in fade-in slide-in-from-bottom-10 duration-1000 flex flex-col items-center">
          
          {/* Disclaimer moved here */}
          <div className="max-w-3xl mx-auto py-3 px-6 rounded-xl bg-[#D4AF37]/10 border border-[#D4AF37]/20 text-[#D4AF37] text-sm mb-8 font-medium leading-loose shadow-[0_0_15px_rgba(212,175,55,0.05)]">
            هذه الأداة مساعد بحثي لطالب العلم، وليست بديلاً عن العلماء. في الفتاوى الخاصة والنوازل يُرجع إلى أهل العلم المختصين.
          </div>

          <h1 className="text-5xl md:text-7xl font-bold text-transparent bg-clip-text bg-gradient-to-b from-[#D4AF37] to-[#8a7020] mb-6 drop-shadow-sm leading-tight">
            باحث السلف
            <br />
            <span className="text-3xl md:text-5xl text-[#E0E0E0] mt-4 block font-light">للعلم الشرعي </span>
          </h1>
          <p className="max-w-2xl mx-auto text-gray-300 text-base md:text-lg leading-relaxed mb-10">
            أداة بحثية تساعدك على الوصول السريع إلى الجواب الشرعي، مع إظهار المنهجية والمراجع قدر الإمكان.
          </p>
          
          <button 
            onClick={onStartChat}
            className="group relative px-8 py-4 bg-[#D4AF37] text-[#121212] font-bold text-lg rounded-full shadow-[0_0_20px_rgba(212,175,55,0.4)] hover:shadow-[0_0_30px_rgba(212,175,55,0.6)] hover:scale-105 transition-all duration-300"
          >
            <span className="flex items-center gap-2">
              ابدأ البحث الآن
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:-translate-x-1">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
            </span>
          </button>
        </div>
      </main>

      <section className="relative z-10 w-full bg-[#121212]/50 backdrop-blur-xl border-t border-[#333]">
        <div className="max-w-6xl mx-auto px-6 py-24">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-[#E0E0E0] mb-4">كيف يعمل باحث السلف؟</h2>
            <p className="text-gray-300 max-w-2xl mx-auto leading-relaxed text-base md:text-lg">
              صُمم ليكون أداة بحث تساعدك على الوصول السريع للجواب، مع إبراز المنهجية والتنبيه إلى أن مسائل الفتوى الخاصة تُرجع لأهل العلم.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-[#1E1E1E]/50 backdrop-blur-sm p-7 rounded-2xl border border-[#D4AF37]/10">
              <h3 className="text-xl font-bold text-[#D4AF37] mb-3">المرجعية</h3>
              <p className="text-gray-300 leading-relaxed text-sm md:text-base">
                يعتمد الجواب على القرآن الكريم والسنة الصحيحة، مع اعتبار فهم السلف الصالح وأقوال أهل العلم المعتبرين.
              </p>
            </div>

            <div className="bg-[#1E1E1E]/50 backdrop-blur-sm p-7 rounded-2xl border border-[#D4AF37]/10">
              <h3 className="text-xl font-bold text-[#D4AF37] mb-3">طريقة العرض</h3>
              <p className="text-gray-300 leading-relaxed text-sm md:text-base">
                يركّز على الجواب الواضح، مع إظهار المصادر والمراجع داخل الرد لتسهيل المراجعة وعدم الاكتفاء بالنص المجرد.
              </p>
            </div>

            <div className="bg-[#1E1E1E]/50 backdrop-blur-sm p-7 rounded-2xl border border-[#D4AF37]/10">
              <h3 className="text-xl font-bold text-[#D4AF37] mb-3">الحدود</h3>
              <p className="text-gray-300 leading-relaxed text-sm md:text-base">
                هو مساعد بحثي وليس بديلاً عن العلماء، ولذلك تبقى النوازل والفتاوى الخاصة بحاجة إلى الرجوع لأهل العلم المختصين.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="about" className="relative z-10 w-full bg-[#0a0a0a] border-t border-[#333] py-24">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-[#D4AF37] mb-4">عن المشروع</h2>
          <p className="text-gray-300 max-w-3xl mx-auto leading-relaxed text-base md:text-lg">
            الهدف من Salaf AI هو تسهيل الوصول إلى العلم الشرعي الموثوق بصياغة واضحة وتجربة استخدام بسيطة، مع الحفاظ على إظهار المنهجية والمراجع قدر الإمكان.
          </p>
        </div>
      </section>

      {/* Download App Section (New) */}
      <section className="relative z-10 w-full pt-20 px-6">
          <div className="max-w-4xl mx-auto">
             <div className="relative overflow-hidden rounded-3xl bg-[#1E1E1E]/40 border border-[#D4AF37]/20 p-8 flex flex-col md:flex-row items-center justify-between gap-6 hover:bg-[#1E1E1E]/60 transition-colors duration-300">
                 
                 <div className="flex flex-col md:flex-row items-center gap-6 text-center md:text-right">
                    <div className="w-16 h-16 bg-[#D4AF37]/10 rounded-2xl flex items-center justify-center text-[#D4AF37] border border-[#D4AF37]/20 shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>
                    </div>
                    <div>
                        <h3 className="text-xl font-bold text-[#E0E0E0] mb-2">حمل تطبيق باحث السلف</h3>
                        <p className="text-gray-400 text-sm max-w-md leading-relaxed">
                            لتجربة استخدام أسرع ووصول مباشر بدون متصفح، قم بتثبيت التطبيق على شاشتك الرئيسية الآن.
                        </p>
                    </div>
                 </div>

                 <button 
                   onClick={onInstallClick}
                   className="px-6 py-3 bg-[#D4AF37]/10 hover:bg-[#D4AF37] text-[#D4AF37] hover:text-[#121212] border border-[#D4AF37]/30 font-bold rounded-xl transition-all duration-300 whitespace-nowrap flex items-center gap-2 shrink-0"
                 >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                    <span>تثبيت التطبيق</span>
                 </button>
             </div>
          </div>
      </section>

      {/* Donation Section */}
      <section className="relative z-10 w-full py-20 px-6">
          <div className="max-w-4xl mx-auto">
             <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#1E1E1E] to-[#000000] border border-[#D4AF37]/30 shadow-[0_0_40px_rgba(212,175,55,0.1)] p-8 md:p-12 text-center">
                 {/* Decorative background glow */}
                 <div className="absolute top-0 right-0 w-64 h-64 bg-[#D4AF37]/10 blur-[80px] rounded-full pointer-events-none"></div>
                 
                 <h2 className="text-3xl md:text-4xl font-bold text-[#D4AF37] mb-6 relative z-10">ساهم في استمرار هذا الخير</h2>
                 <p className="text-gray-300 text-lg leading-relaxed mb-8 max-w-2xl mx-auto relative z-10">
                    هذا المشروع قائم بجهود ذاتية لخدمة طلاب العلم. مساهمتك تساعدنا في تغطية تكاليف الخوادم وتطوير النماذج لتبقى هذه الخدمة متاحة ومجانية للجميع. اجعلها صدقة جارية لك.
                 </p>
                 
                 <a 
                   href="https://ko-fi.com/its3li"
                   target="_blank"
                   rel="noopener noreferrer"
                   className="relative z-10 px-8 py-4 bg-gradient-to-r from-[#D4AF37] to-[#B59220] hover:from-[#E5C048] hover:to-[#C6A331] text-[#121212] font-bold text-lg rounded-xl shadow-lg transform hover:scale-105 transition-all duration-300 inline-flex items-center justify-center gap-2 mx-auto"
                 >
                    <span>ادعم المشروع الآن</span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                 </a>
             </div>
          </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 w-full py-8 text-center border-t border-[#333] bg-[#000]">
        <div className="flex justify-center items-center gap-6 mb-4">
            {/* Facebook */}
            <a href="https://www.facebook.com/share/1FY1sZzk19/" target="_blank" rel="noopener noreferrer" className="text-[#777] hover:text-[#D4AF37] transition-colors duration-300" aria-label="Facebook">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M9 8h-3v4h3v12h5v-12h3.642l.358-4h-4v-1.667c0-.955.192-1.333 1.115-1.333h2.885v-5h-3.808c-3.596 0-5.192 1.583-5.192 4.615v3.385z"/></svg>
            </a>
            
            {/* Instagram */}
            <a href="https://www.instagram.com/_salafai_?igsh=eHVzcndzaHcxbTg0" target="_blank" rel="noopener noreferrer" className="text-[#777] hover:text-[#D4AF37] transition-colors duration-300" aria-label="Instagram">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg>
            </a>
            
            {/* TikTok */}
            <a href="https://www.tiktok.com/@o1_18" target="_blank" rel="noopener noreferrer" className="text-[#777] hover:text-[#D4AF37] transition-colors duration-300" aria-label="TikTok">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93v6.16c0 2.52-1.12 4.88-2.91 6.52-1.78 1.63-4.15 2.54-6.55 2.52-1.57-.01-3.13-.42-4.52-1.18-1.4-.76-2.61-1.85-3.52-3.16-.91-1.32-1.48-2.83-1.64-4.43-.16-1.6.03-3.21.55-4.73.52-1.51 1.4-2.88 2.54-3.98 1.15-1.11 2.57-1.92 4.11-2.34 1.54-.43 3.16-.47 4.73-.12V5.5c-1.28-.48-2.68-.62-4.03-.41-1.35.21-2.62.83-3.65 1.77-1.02.94-1.72 2.18-1.99 3.53-.27 1.35-.14 2.75.37 4.04.51 1.28 1.38 2.4 2.51 3.2 1.13.8 2.47 1.26 3.86 1.31 1.38.06 2.75-.32 3.94-1.08 1.18-.76 2.14-1.84 2.72-3.12.06-.13.12-.27.17-.41V.02h3.91z"/></svg>
            </a>
        </div>
        <p className="text-[#555] text-sm">© 2025 Salaf AI. جميع الحقوق محفوظة.</p>
      </footer>
    </div>
  );
};