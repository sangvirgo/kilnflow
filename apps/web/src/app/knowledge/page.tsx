'use client';
import KnowledgeChat from '../../components/KnowledgeChat';

export default function KnowledgePage() {
  return (
    <div>
      <h1 className='text-xl font-bold mb-1'>Hỏi đáp tri thức gốm sứ</h1>
      <p className='text-xs text-gray-500 mb-3'>
        Chatbot trả lời CHỈ dựa trên tài liệu nội bộ của xưởng và trích dẫn nguồn [Nguồn N] dưới mỗi câu trả lời.
        Bạn cũng có thể chat nhanh bằng ô 💬 ở góc phải màn hình.
      </p>
      <KnowledgeChat variant='page' />
    </div>
  );
}
