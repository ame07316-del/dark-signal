export function movementStatus(life: string, microphone: boolean, finished: boolean): string {
  if (finished) return 'انتهت الجولة وتوقفت الحركة. المضيف يضغط «إعادة للردهة» للعب مجددًا.';
  if (life === 'downed') return 'أنت ساقط؛ الحركة متوقفة حتى ينقذك زميل بالضغط لمدة ١٠ ثوانٍ.';
  if (life === 'last-chance') return 'بلا قلوب؛ الحركة متوقفة حتى ينقذك زميل في الفرصة الأخيرة.';
  if (life === 'eliminated') return 'خرجت من الجولة؛ الحركة متوقفة ويمكنك مشاهدة زميل.';
  if (life === 'escaped') return 'هربت من القصر؛ الحركة متوقفة ويمكنك مشاهدة زميل.';
  if (!microphone) return 'الحركة متوقفة لأن المايك غير جاهز. اضغط تشغيل المايك وأكمل المعايرة.';
  return '';
}
