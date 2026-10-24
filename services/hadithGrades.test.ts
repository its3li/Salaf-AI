import { describe, it, expect } from 'vitest';
import { gradeTone } from './hadithGrades';

// Grades as Dorar.net writes them (most collected from its results in October 2026).
describe('gradeTone', () => {
  it('reads plain grades of soundness as sound', () => {
    for (const grade of [
      'صحيح',
      '[صحيح]',
      'إسناده صحيح',
      'حسن صحيح',
      'صحيح غريب',
      'صحيح لغيره',
      'إسناده حسن',
      'ثابت',
      'رجاله ثقات',
      'أخرجه في صحيحه',
      'ثبت في الحديث المجمع على صحته',
      'مشهور بالصحة',
      'صحيح على شرط الشيخين',
    ]) {
      expect(gradeTone(grade), grade).toBe('sound');
    }
  });

  it('reads denials and criticism as weak, even when they hold a word of praise', () => {
    for (const grade of [
      'ليس حديثا',
      'ليس بحديث، لكن معناه صحيح',
      'رفعه إلى النبي صلى الله عليه وسلم ليس بصحيح',
      'غير صحيح',
      'ضعيف لا يصح',
      'إسناده ليس بالقوي',
      'إسناده ضعيف ومتنه صحيح',
      'كذب، ليس له أصل، منكر جداً',
      '[فيه] أبو العاتكة لا يعرف، وليس لهذا الحديث أصل',
      '[فيه] عَبْد الرَّحْمنِ بن ثابت بن ثوبان، وهو ضعيف',
      '[في] إسناده رجلان مجهولان',
      'إسناده واه',
    ]) {
      expect(gradeTone(grade), grade).toBe('weak');
    }
  });

  it('leaves grades that say neither plainly grey, so they never look authentic', () => {
    for (const grade of [
      'أورده مسلم في مقدمة صحيحه',
      '[أورده مسلم في مقدمة الصحيح]',
      'علقه البخاري في صحيحه',
      'سكت عنه [وقد قال في رسالته لأهل مكة كل ما سكت عنه فهو صالح]',
      'لم أقف عليه',
      'الصواب مرسل',
      'روي مرسلاً ومسنداً',
      'لا يعرف إلا من حديث فلان',
      '[فيه] حسن بن صالح',
    ]) {
      expect(gradeTone(grade), grade).toBe('unclear');
    }
  });
});
