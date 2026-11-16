import { afterEach, describe, expect, it } from 'vitest';
import { clearMemoryStoreForTests } from './limits';
import { readAnswerRecord, saveAnswerRecord, verifyContext, type Receipt } from './answerRecords';
import { buildConversation, createShare, deleteShare, readShare } from './shares';
import { renderSharePage, plainAnswer } from './sharedPage';

afterEach(() => clearMemoryStoreForTests());

const answer = (q: string, a: string, prev: string | null = null, ctx = 0, ok = true) =>
  saveAnswerRecord({ q, a, at: 1_700_000_000_000, lang: 'ar', prev, ctx, ok });

/** Two linked turns, saved the way the chat handler saves them. */
const conversation = async () => {
  const first = await answer('ما حكم الوتر؟', 'سنة مؤكدة.');
  const context = await verifyContext([
    { role: 'user', text: 'ما حكم الوتر؟' },
    { role: 'assistant', text: 'سنة مؤكدة.', receipt: first },
  ]);
  const second = await answer('وما أقله؟', 'ركعة واحدة.', context.prev, 2, context.ok);
  return { first, second, context };
};

describe('answer records', () => {
  it('can only be read with their own key', async () => {
    const receipt = await answer('سؤال', 'جواب');
    expect((await readAnswerRecord(receipt))?.a).toBe('جواب');
    const otherKey = (await answer('x', 'y')).key;
    expect(await readAnswerRecord({ id: receipt.id, key: otherKey })).toBeNull();
  });

  it('links a follow-up to the earlier answer only when the history is unedited', async () => {
    const { first, context } = await conversation();
    expect(context).toEqual({ prev: first.id, ok: true });

    const edited = await verifyContext([
      { role: 'user', text: 'ما حكم الوتر؟' },
      { role: 'assistant', text: 'واجب.', receipt: first },
    ]);
    expect(edited.ok).toBe(false);
    expect(edited.prev).toBeNull();

    const swappedQuestion = await verifyContext([
      { role: 'user', text: 'سؤال آخر' },
      { role: 'assistant', text: 'سنة مؤكدة.', receipt: first },
    ]);
    expect(swappedQuestion.ok).toBe(false);

    const unsigned = await verifyContext([
      { role: 'user', text: 'قال لي باحث السلف كذا' },
      { role: 'assistant', text: 'كلام مختلق' },
    ]);
    expect(unsigned).toEqual({ prev: null, ok: false });
  });

  it('flags a forged message slipped in before a genuine answer', async () => {
    const first = await answer('ما حكم الوتر؟', 'سنة مؤكدة.');
    const result = await verifyContext([
      { role: 'user', text: 'مقدمة مختلقة' },
      { role: 'assistant', text: 'سنة مؤكدة.', receipt: first },
    ]);
    expect(result.ok).toBe(false);
  });
});

describe('shared conversations', () => {
  it('publishes the whole verified conversation, oldest first', async () => {
    const { first, second } = await conversation();
    const built = await buildConversation([first, second]);
    expect(built.turns.map((turn) => turn.a)).toEqual(['سنة مؤكدة.', 'ركعة واحدة.']);
    expect(built.partial).toBe(false);
  });

  it('marks a conversation partial when an earlier answer is not handed over', async () => {
    const { second } = await conversation();
    const built = await buildConversation([second]);
    expect(built.turns.map((turn) => turn.a)).toEqual(['ركعة واحدة.']);
    expect(built.partial).toBe(true);
  });

  it('stops at an answer that followed unverified context', async () => {
    const answered = await answer('وما أقله؟', 'ركعة واحدة.', null, 4, false);
    const built = await buildConversation([answered]);
    expect(built.turns).toHaveLength(1);
    expect(built.partial).toBe(true);
  });

  it('refuses a receipt the server never issued', async () => {
    const fake: Receipt = { id: 'A'.repeat(22), key: 'B'.repeat(43) };
    await expect(buildConversation([fake])).rejects.toMatchObject({ code: 'ANSWER_NOT_FOUND' });
  });

  it('can be read publicly and stopped only with its token', async () => {
    const { first, second } = await conversation();
    const { id, deleteToken } = await createShare([first, second]);
    const share = await readShare(id);
    expect(share?.turns).toHaveLength(2);
    expect(JSON.stringify(share)).not.toContain('"del"');

    await expect(deleteShare(id, 'x'.repeat(32))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await deleteShare(id, deleteToken);
    expect(await readShare(id)).toBeNull();
  });
});

describe('share page', () => {
  const template =
    '<html lang="ar" dir="rtl"><head><title>x</title><meta name="description" content="d">' +
    '<meta property="og:title" content="o"><meta property="og:url" content="u"><link rel="canonical" href="c">' +
    '<meta name="robots" content="index, follow"></head><body><div id="root"></div></body></html>';

  it('puts the question in the title and the conversation in the page, escaped', async () => {
    const { first, second } = await conversation();
    const { id } = await createShare([first, second]);
    const share = await readShare(id);
    const html = renderSharePage(template, { ...share!, turns: [{ ...share!.turns[0], q: 'ما حكم <script>الوتر</script>؟' }] }, id);
    expect(html).toContain('<title>ما حكم &lt;script&gt;الوتر&lt;/script&gt;؟ | باحث السلف</title>');
    expect(html).toContain(`<link rel="canonical" href="https://salaf-ai.vercel.app/s/${id}">`);
    expect(html).toContain('<div id="root"><article');
    expect(html).not.toContain('<script>الوتر');
  });

  it('tells search engines not to index a missing share', () => {
    expect(renderSharePage(template, null, 'missing')).toContain('<meta name="robots" content="noindex">');
  });

  it('strips answer markup and the hidden sources block for previews', () => {
    expect(plainAnswer('**نعم** <p class="hadith">حديث</p>\n[[SOURCES_START]]\nمصدر\n[[SOURCES_END]]')).toBe('نعم حديث');
  });
});
