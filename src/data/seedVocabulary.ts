import type { SystemListSlug, Word, WordListItem } from '../domain/types'
import { SEED_CONTENT_REVISION } from './seedContentRevision'
import { listSlugsForSeedCategory } from './listAssignment'
import { listIdForSlug } from './vocabularyLists'
import { escapeRegExp, uniqueStrings } from '../lib/text'

type SeedCategory = 'daily' | 'finance' | 'business'

interface SeedRow {
  expression: string
  sense: string
  zh: string
  definition: string
  partOfSpeech: string
  zhAnswers?: string[]
  variants?: string[]
  collocations: string[]
  examples: [[string, string], [string, string]]
  sentencePrompt?: string
}

const SEED_TIMESTAMP = '2026-08-10T00:00:00.000Z'

const categoryContext: Record<SeedCategory, string> = {
  daily: 'Malaysian campus or everyday-life',
  finance: 'finance or accounting',
  business: 'startup or business',
}

function makeCloze(sentence: string, expression: string): string {
  return sentence.replace(new RegExp(escapeRegExp(expression), 'i'), '_____')
}

function buildCategory(category: SeedCategory, rows: SeedRow[]): Word[] {
  return rows.map((row, index) => {
    const serial = String(index + 1).padStart(3, '0')
    // Preserve historical seed ids (e.g. seed-finance-001) so existing FSRS tracks stay valid.
    const id = 'seed-' + category + '-' + serial
    const firstExample = { en: row.examples[0][0], zh: row.examples[0][1] }
    const secondExample = { en: row.examples[1][0], zh: row.examples[1][1] }
    const lemma = row.expression.trim().toLocaleLowerCase('en-US')

    return {
      id,
      expression: row.expression,
      lemma,
      senseKey: category + ':' + row.sense,
      zhGloss: row.zh,
      enDefinition: row.definition,
      partOfSpeech: row.partOfSpeech,
      acceptedZhAnswers: uniqueStrings([row.zh, ...(row.zhAnswers ?? [])]),
      acceptedEnVariants: uniqueStrings([row.expression, ...(row.variants ?? [])]),
      examples: [firstExample, secondExample],
      collocations: row.collocations,
      source: 'seed',
      priority: index + 1,
      status: 'active',
      usagePrompts: [
        {
          id: id + '-cloze',
          type: 'cloze',
          prompt: 'Complete the sentence: ' + makeCloze(firstExample.en, row.expression),
          answer: row.expression,
          modelAnswer: firstExample.en,
          checkpoints: uniqueStrings([row.expression, row.collocations[0]]),
        },
        {
          id: id + '-sentence',
          type: 'sentence',
          prompt:
            row.sentencePrompt ??
            'Write a natural ' + categoryContext[category] + ' sentence using "' + row.expression + '".',
          modelAnswer: secondExample.en,
          checkpoints: [row.expression],
        },
      ],
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    }
  })
}

function buildMemberships(category: SeedCategory, words: Word[]): WordListItem[] {
  const memberships: WordListItem[] = []
  for (const [index, word] of words.entries()) {
    const slugs = listSlugsForSeedCategory(category, word.expression)
    for (const [slugIndex, slug] of slugs.entries()) {
      memberships.push({
        id: `membership-${word.id}-${slug}`,
        wordId: word.id,
        listId: listIdForSlug(slug),
        priority: word.priority,
        sortOrder: index * 10 + slugIndex,
      })
    }
  }
  return memberships
}

const dailyRows: SeedRow[] = [
  {
    expression: 'assignment', sense: 'university-task', zh: '课程作业', definition: 'a piece of work given to a student as part of a course', partOfSpeech: 'noun', zhAnswers: ['作业'], collocations: ['submit an assignment', 'complete an assignment', 'assignment deadline'],
    examples: [['Our finance assignment is due on Friday.', '我们的金融课程作业周五截止。'], ['I finished the assignment in the campus library.', '我在校园图书馆完成了这份课程作业。']],
  },
  {
    expression: 'deadline', sense: 'latest-completion-time', zh: '截止日期', definition: 'the latest time or date by which something must be completed', partOfSpeech: 'noun', zhAnswers: ['最后期限'], collocations: ['meet a deadline', 'miss a deadline', 'tight deadline'],
    examples: [['The deadline for the report is next Monday.', '这份报告的截止日期是下周一。'], ['I set a reminder so that I would not miss the deadline.', '我设置了提醒，以免错过截止日期。']],
  },
  {
    expression: 'lecture', sense: 'university-class-talk', zh: '大学讲座课', definition: 'a formal talk given to a group of students as part of a course', partOfSpeech: 'noun', zhAnswers: ['讲座', '大课'], collocations: ['attend a lecture', 'lecture notes', 'morning lecture'],
    examples: [['The lecture on corporate finance starts at nine.', '公司金融讲座课九点开始。'], ['I reviewed my lecture notes before the quiz.', '小测前我复习了讲座课笔记。']],
  },
  {
    expression: 'tutorial', sense: 'small-group-class', zh: '辅导课', definition: 'a small class in which students discuss a subject with a tutor', partOfSpeech: 'noun', collocations: ['attend a tutorial', 'tutorial group', 'weekly tutorial'],
    examples: [['We discussed the case study in our tutorial.', '我们在辅导课上讨论了这个案例。'], ['Please prepare the questions before tomorrow\'s tutorial.', '请在明天的辅导课前准备好问题。']],
  },
  {
    expression: 'seminar', sense: 'discussion-class', zh: '研讨课', definition: 'a class where a small group discusses a particular subject', partOfSpeech: 'noun', collocations: ['attend a seminar', 'seminar discussion', 'research seminar'],
    examples: [['The seminar focused on sustainable investment.', '这次研讨课聚焦于可持续投资。'], ['She asked a thoughtful question during the seminar.', '她在研讨课上提出了一个有深度的问题。']],
  },
  {
    expression: 'attendance', sense: 'presence-at-class', zh: '出勤', definition: 'the act of being present at a class or event', partOfSpeech: 'noun', collocations: ['record attendance', 'attendance requirement', 'regular attendance'],
    examples: [['Attendance is required for every accounting tutorial.', '每次会计辅导课都要求出勤。'], ['The lecturer records attendance with a QR code.', '讲师用二维码记录出勤。']],
  },
  {
    expression: 'syllabus', sense: 'course-outline', zh: '课程大纲', definition: 'a document that lists the topics, requirements, and schedule for a course', partOfSpeech: 'noun', collocations: ['course syllabus', 'read the syllabus', 'syllabus update'],
    examples: [['The syllabus lists all assessment dates.', '课程大纲列出了所有考核日期。'], ['Check the syllabus before emailing the lecturer.', '给讲师发邮件前先查看课程大纲。']],
  },
  {
    expression: 'revise', sense: 'study-again-uk', zh: '复习', definition: 'to study material again in preparation for an examination', partOfSpeech: 'verb', variants: ['review'], collocations: ['revise for an exam', 'revise a topic', 'revise thoroughly'],
    examples: [['I revise in short sessions after each lecture.', '每次讲座课后我都会用短时间复习。'], ['We met at the library to revise for the accounting exam.', '我们在图书馆集合，复习会计考试。']],
  },
  {
    expression: 'submit', sense: 'hand-in-work', zh: '提交', definition: 'to formally send work to someone for consideration or marking', partOfSpeech: 'verb', zhAnswers: ['递交'], collocations: ['submit an assignment', 'submit online', 'submit on time'],
    examples: [['Please submit the spreadsheet through the student portal.', '请通过学生门户提交电子表格。'], ['I checked the file name before I clicked submit.', '点击提交前，我检查了文件名。']],
  },
  {
    expression: 'extension', sense: 'extra-time', zh: '延期', definition: 'extra time allowed to complete a task or meet a deadline', partOfSpeech: 'noun', zhAnswers: ['延长期限'], collocations: ['request an extension', 'grant an extension', 'two-day extension'],
    examples: [['She requested an extension because she was ill.', '她因生病申请了延期。'], ['The lecturer granted a two-day extension for the project.', '讲师给这个项目延长了两天期限。']],
  },
  {
    expression: 'feedback', sense: 'comments-for-improvement', zh: '反馈意见', definition: 'comments about work that explain what is good and what can be improved', partOfSpeech: 'noun', zhAnswers: ['反馈'], collocations: ['give feedback', 'receive feedback', 'constructive feedback'],
    examples: [['The tutor gave useful feedback on my presentation.', '导师对我的演示给出了有用的反馈意见。'], ['I used the feedback to improve my second draft.', '我利用这些反馈改进了第二稿。']],
  },
  {
    expression: 'group project', sense: 'shared-course-task', zh: '小组项目', definition: 'a course task completed jointly by several students', partOfSpeech: 'noun phrase', collocations: ['work on a group project', 'group project meeting', 'lead a group project'],
    examples: [['Our group project compares two Malaysian banks.', '我们的小组项目比较两家马来西亚银行。'], ['We divided the research tasks for the group project.', '我们分配了小组项目的研究任务。']],
  },
  {
    expression: 'presentation', sense: 'formal-class-talk', zh: '演示汇报', definition: 'a talk in which information is explained to an audience', partOfSpeech: 'noun', zhAnswers: ['展示', '汇报'], collocations: ['give a presentation', 'presentation slides', 'prepare a presentation'],
    examples: [['My presentation explains how inflation affects savings.', '我的演示汇报解释通货膨胀如何影响储蓄。'], ['We practised the presentation before class.', '我们在上课前练习了这次演示。']],
  },
  {
    expression: 'coursemate', sense: 'student-on-same-course', zh: '同专业同学', definition: 'a person who studies the same course as you', partOfSpeech: 'noun', variants: ['course mate'], collocations: ['ask a coursemate', 'help a coursemate', 'meet a coursemate'],
    examples: [['A coursemate shared the tutorial notes with me.', '一位同专业同学和我分享了辅导课笔记。'], ['I practised English with a coursemate after class.', '课后我和一位同专业同学练习英语。']],
  },
  {
    expression: 'lecturer', sense: 'university-teacher', zh: '大学讲师', definition: 'a person who teaches at a university or college', partOfSpeech: 'noun', zhAnswers: ['讲师'], collocations: ['ask the lecturer', 'senior lecturer', 'contact a lecturer'],
    examples: [['The lecturer explained the formula with a simple example.', '大学讲师用一个简单例子解释了公式。'], ['I emailed the lecturer to clarify the marking criteria.', '我给讲师发邮件确认评分标准。']],
  },
  {
    expression: 'elective', sense: 'optional-course', zh: '选修课', definition: 'a course that a student may choose rather than being required to take', partOfSpeech: 'noun', collocations: ['choose an elective', 'finance elective', 'elective module'],
    examples: [['I chose entrepreneurship as my elective.', '我选择创业学作为选修课。'], ['This elective includes a practical business project.', '这门选修课包含一个实践商业项目。']],
  },
  {
    expression: 'enrol', sense: 'register-for-course-uk', zh: '注册入读', definition: 'to officially register as a member of a course or institution', partOfSpeech: 'verb', variants: ['enroll'], collocations: ['enrol in a course', 'enrol online', 'enrolment period'],
    examples: [['You must enrol before the registration period closes.', '你必须在注册期结束前注册入读。'], ['I plan to enrol in a financial modelling course.', '我计划注册一门金融建模课程。']],
  },
  {
    expression: 'scholarship', sense: 'study-funding-award', zh: '奖学金', definition: 'money awarded to a student to help pay for education', partOfSpeech: 'noun', collocations: ['apply for a scholarship', 'receive a scholarship', 'scholarship application'],
    examples: [['The scholarship covers half of my tuition fees.', '这项奖学金承担我一半的学费。'], ['She prepared her documents for the scholarship application.', '她为奖学金申请准备了文件。']],
  },
  {
    expression: 'tuition fees', sense: 'course-study-cost', zh: '学费', definition: 'money paid to an educational institution for teaching', partOfSpeech: 'plural noun', variants: ['tuition fee'], collocations: ['pay tuition fees', 'annual tuition fees', 'tuition fee payment'],
    examples: [['My tuition fees are paid in two instalments.', '我的学费分两期支付。'], ['The university portal shows the remaining tuition fees.', '大学门户显示尚未支付的学费。']],
  },
  {
    expression: 'campus', sense: 'university-grounds', zh: '校园', definition: 'the buildings and grounds of a university or college', partOfSpeech: 'noun', collocations: ['on campus', 'campus facilities', 'main campus'],
    examples: [['There is a cash machine near the campus entrance.', '校园入口附近有一台自动取款机。'], ['I usually have lunch on campus between classes.', '我通常在两节课之间在校园吃午饭。']],
  },
  {
    expression: 'library', sense: 'study-and-book-place', zh: '图书馆', definition: 'a place where books and other resources can be used or borrowed', partOfSpeech: 'noun', collocations: ['campus library', 'library card', 'study in the library'],
    examples: [['The library stays open late during exam week.', '考试周期间图书馆会开放到很晚。'], ['I booked a quiet room in the library for our meeting.', '我在图书馆预订了一间安静的房间开会。']],
  },
  {
    expression: 'citation', sense: 'source-reference', zh: '文献引用', definition: 'a reference to the source of information used in academic work', partOfSpeech: 'noun', zhAnswers: ['引用'], collocations: ['include a citation', 'citation style', 'in-text citation'],
    examples: [['Every quotation needs a citation.', '每一处引文都需要文献引用。'], ['I checked the required citation style before submitting.', '提交前我检查了要求的引用格式。']],
  },
  {
    expression: 'plagiarism', sense: 'uncredited-copying', zh: '抄袭', definition: 'using another person\'s words or ideas without acknowledging the source', partOfSpeech: 'noun', collocations: ['avoid plagiarism', 'plagiarism policy', 'plagiarism check'],
    examples: [['The university has a strict plagiarism policy.', '大学有严格的抄袭规定。'], ['Paraphrasing still requires a source to avoid plagiarism.', '即使改写也需要注明来源，以避免抄袭。']],
  },
  {
    expression: 'internship', sense: 'temporary-work-experience', zh: '实习', definition: 'a period of practical work experience offered to a student or trainee', partOfSpeech: 'noun', collocations: ['apply for an internship', 'summer internship', 'complete an internship'],
    examples: [['I applied for an internship at an audit firm.', '我申请了一家审计事务所的实习。'], ['The internship helped me understand office communication.', '这段实习帮助我理解职场沟通。']],
  },
  {
    expression: 'accommodation', sense: 'place-to-live', zh: '住宿', definition: 'a place where someone lives or stays', partOfSpeech: 'noun', collocations: ['student accommodation', 'find accommodation', 'affordable accommodation'],
    examples: [['Student accommodation near campus fills up quickly.', '校园附近的学生住宿很快就会住满。'], ['I compared the rent before choosing accommodation.', '选择住宿前，我比较了租金。']],
  },
  {
    expression: 'landlord', sense: 'property-owner-renting-out', zh: '房东', definition: 'a person who owns a property and rents it to someone else', partOfSpeech: 'noun', collocations: ['contact the landlord', 'private landlord', 'tell the landlord'],
    examples: [['I told the landlord that the tap was leaking.', '我告诉房东水龙头漏水。'], ['The landlord sent someone to repair the lock.', '房东派人来修锁。']],
  },
  {
    expression: 'tenancy agreement', sense: 'rental-contract', zh: '租赁协议', definition: 'a legal agreement between a landlord and a tenant', partOfSpeech: 'noun phrase', variants: ['rental agreement', 'lease agreement'], collocations: ['sign a tenancy agreement', 'read the tenancy agreement', 'tenancy agreement terms'],
    examples: [['Read the tenancy agreement before paying the deposit.', '支付押金前先阅读租赁协议。'], ['The tenancy agreement states who pays for repairs.', '租赁协议说明由谁承担维修费。']],
  },
  {
    expression: 'deposit', sense: 'refundable-rental-payment', zh: '押金', definition: 'money paid in advance as security and usually returned if conditions are met', partOfSpeech: 'noun', zhAnswers: ['保证金'], collocations: ['pay a deposit', 'refundable deposit', 'return the deposit'],
    examples: [['The deposit is equal to two months\' rent.', '押金相当于两个月的租金。'], ['Take photos of the room to protect your deposit.', '给房间拍照，以保障押金能退回。']],
  },
  {
    expression: 'utility bill', sense: 'household-service-charge', zh: '水电网账单', definition: 'a bill for household services such as electricity, water, or gas', partOfSpeech: 'noun phrase', collocations: ['pay a utility bill', 'monthly utility bill', 'share utility bills'],
    examples: [['Our utility bill increased because we used more air conditioning.', '因为使用了更多空调，我们的水电网账单增加了。'], ['The flatmates share each utility bill equally.', '室友们平分每张水电网账单。']],
  },
  {
    expression: 'flatmate', sense: 'person-sharing-flat-uk', zh: '合租室友', definition: 'a person who shares a flat with you', partOfSpeech: 'noun', variants: ['roommate', 'housemate'], collocations: ['new flatmate', 'share with a flatmate', 'ask a flatmate'],
    examples: [['My flatmate and I take turns buying drinking water.', '我和合租室友轮流购买饮用水。'], ['I asked my flatmate to keep the kitchen clean.', '我请室友保持厨房清洁。']],
  },
  {
    expression: 'maintenance', sense: 'property-repair-service', zh: '维修保养', definition: 'work done to keep a building or equipment in good condition', partOfSpeech: 'noun', collocations: ['request maintenance', 'maintenance team', 'routine maintenance'],
    examples: [['I submitted a maintenance request for the broken fan.', '我提交了维修坏风扇的申请。'], ['The maintenance team will inspect the lift tomorrow.', '维修团队明天会检查电梯。']],
  },
  {
    expression: 'air conditioning', sense: 'indoor-cooling-system', zh: '空调', definition: 'a system that cools and controls the air inside a building', partOfSpeech: 'noun', variants: ['air-conditioning', 'AC'], collocations: ['turn on the air conditioning', 'air-conditioning unit', 'central air conditioning'],
    examples: [['The air conditioning in our classroom is very cold.', '我们教室的空调很冷。'], ['Please turn off the air conditioning when you leave.', '离开时请关掉空调。']],
  },
  {
    expression: 'commute', sense: 'regular-travel-to-study', zh: '通勤', definition: 'to travel regularly between home and a place of work or study', partOfSpeech: 'verb', collocations: ['commute to campus', 'daily commute', 'long commute'],
    examples: [['I commute to campus by train and bus.', '我乘火车和公交车通勤到校园。'], ['She studies vocabulary during her morning commute.', '她在早晨通勤时学习词汇。']],
  },
  {
    expression: 'fare', sense: 'transport-price', zh: '交通票价', definition: 'the money paid for a journey on public transport or in a taxi', partOfSpeech: 'noun', zhAnswers: ['车费'], collocations: ['bus fare', 'train fare', 'pay the fare'],
    examples: [['The train fare is cheaper with a student card.', '使用学生卡的火车票价更便宜。'], ['Check the fare before confirming an e-hailing ride.', '确认网约车行程前先查看车费。']],
  },
  {
    expression: 'top up', sense: 'add-credit', zh: '充值', definition: 'to add money or credit to a card, account, or phone', partOfSpeech: 'phrasal verb', variants: ['recharge'], collocations: ['top up a card', 'top up online', 'top up your balance'],
    examples: [['I need to top up my transport card before class.', '上课前我需要给交通卡充值。'], ['You can top up your mobile plan through the app.', '你可以通过应用给手机套餐充值。']],
  },
  {
    expression: 'e-hailing', sense: 'app-booked-ride-service', zh: '网约车服务', definition: 'a service that lets users book a car and driver through an app', partOfSpeech: 'noun', variants: ['ride-hailing'], collocations: ['e-hailing app', 'book an e-hailing ride', 'e-hailing fare'],
    examples: [['We used e-hailing because the last bus had left.', '因为末班公交车已经走了，我们使用了网约车服务。'], ['The e-hailing fare rises during heavy rain.', '大雨期间网约车费用会上涨。']],
  },
  {
    expression: 'traffic jam', sense: 'road-congestion', zh: '交通堵塞', definition: 'a line of vehicles moving very slowly or not moving at all', partOfSpeech: 'noun phrase', collocations: ['stuck in a traffic jam', 'heavy traffic jam', 'avoid a traffic jam'],
    examples: [['The bus was late because of a traffic jam.', '公交车因为交通堵塞而迟到。'], ['Leave early to avoid the morning traffic jam.', '早点出发，避开早高峰堵车。']],
  },
  {
    expression: 'pedestrian crossing', sense: 'marked-road-crossing', zh: '人行横道', definition: 'a marked place where people can cross a road safely', partOfSpeech: 'noun phrase', variants: ['crosswalk'], collocations: ['use the pedestrian crossing', 'at a pedestrian crossing', 'pedestrian crossing signal'],
    examples: [['Use the pedestrian crossing outside the station.', '请使用车站外的人行横道。'], ['Cars must stop when people enter the pedestrian crossing.', '行人进入人行横道时，车辆必须停车。']],
  },
  {
    expression: 'directions', sense: 'route-instructions', zh: '路线指引', definition: 'instructions that explain how to get to a place', partOfSpeech: 'plural noun', zhAnswers: ['方向指示'], collocations: ['ask for directions', 'give directions', 'follow directions'],
    examples: [['I asked the security guard for directions to the finance office.', '我向保安询问去财务办公室的路线。'], ['The directions on the map were easy to follow.', '地图上的路线指引很容易理解。']],
  },
  {
    expression: 'hawker centre', sense: 'shared-local-food-court', zh: '熟食中心', definition: 'a place with many small food stalls and shared seating', partOfSpeech: 'noun phrase', variants: ['hawker center'], collocations: ['eat at a hawker centre', 'nearby hawker centre', 'hawker centre stall'],
    examples: [['The hawker centre near campus has affordable lunches.', '校园附近的熟食中心有价格实惠的午餐。'], ['We tried a new noodle stall at the hawker centre.', '我们在熟食中心尝试了一家新的面摊。']],
  },
  {
    expression: 'takeaway', sense: 'food-to-eat-elsewhere-uk', zh: '外带餐食', definition: 'food bought from a restaurant to be eaten somewhere else', partOfSpeech: 'noun', variants: ['takeout', 'to go'], collocations: ['order a takeaway', 'takeaway container', 'get a takeaway'],
    examples: [['I ordered a takeaway because I had an evening class.', '因为晚上有课，我点了外带餐食。'], ['Please put the sauce in a separate takeaway container.', '请把酱汁放在单独的外带餐盒里。']],
  },
  {
    expression: 'tap water', sense: 'water-from-faucet', zh: '自来水', definition: 'water that comes directly from a tap', partOfSpeech: 'noun', collocations: ['drink tap water', 'boil tap water', 'tap water supply'],
    examples: [['Our landlord advised us to boil tap water before drinking it.', '房东建议我们把自来水烧开后再喝。'], ['The café serves filtered tap water for free.', '这家咖啡馆免费提供过滤后的自来水。']],
  },
  {
    expression: 'spicy', sense: 'hot-flavoured-food', zh: '辛辣的', definition: 'having a strong hot flavour from spices such as chilli', partOfSpeech: 'adjective', zhAnswers: ['辣的'], collocations: ['very spicy', 'spicy food', 'less spicy'],
    examples: [['Could you make the curry less spicy, please?', '可以把咖喱做得不那么辣吗？'], ['This noodle soup is spicy but delicious.', '这碗面汤很辣，但很好吃。']],
  },
  {
    expression: 'food allergy', sense: 'allergic-reaction-to-food', zh: '食物过敏', definition: 'a harmful reaction by the body to a particular food', partOfSpeech: 'noun phrase', collocations: ['have a food allergy', 'severe food allergy', 'food allergy warning'],
    examples: [['I have a food allergy, so I always check the ingredients.', '我有食物过敏，所以总会检查配料。'], ['Tell the server about your food allergy before ordering.', '点餐前告诉服务员你的食物过敏情况。']],
  },
  {
    expression: 'receipt', sense: 'proof-of-payment', zh: '收据', definition: 'a written or electronic record showing that goods or services were paid for', partOfSpeech: 'noun', collocations: ['ask for a receipt', 'keep the receipt', 'digital receipt'],
    examples: [['Keep the receipt in case you need a refund.', '保留收据，以防需要退款。'], ['The cashier sent a digital receipt to my phone.', '收银员把电子收据发送到我手机上。']],
  },
  {
    expression: 'change', sense: 'money-returned-after-payment', zh: '找零', definition: 'money returned when you pay more than the exact price', partOfSpeech: 'noun', zhAnswers: ['零钱'], collocations: ['give change', 'exact change', 'keep the change'],
    examples: [['The driver asked whether I had exact change.', '司机问我是否有刚好的零钱。'], ['I checked my change before leaving the shop.', '离开商店前我核对了找零。']],
  },
  {
    expression: 'queue', sense: 'line-of-waiting-people-uk', zh: '队伍', definition: 'a line of people waiting for something', partOfSpeech: 'noun', variants: ['line'], collocations: ['join a queue', 'wait in a queue', 'long queue'],
    examples: [['There was a long queue at the campus café.', '校园咖啡馆排着很长的队伍。'], ['I joined the queue for student registration.', '我排进了学生注册的队伍。']],
  },
  {
    expression: 'appointment', sense: 'arranged-meeting-time', zh: '预约', definition: 'an arrangement to meet someone at a particular time', partOfSpeech: 'noun', collocations: ['make an appointment', 'book an appointment', 'appointment time'],
    examples: [['I made an appointment with the academic adviser.', '我预约了学业顾问。'], ['Please arrive ten minutes before your appointment.', '请在预约时间前十分钟到达。']],
  },
  {
    expression: 'clinic', sense: 'small-medical-centre', zh: '诊所', definition: 'a place where people receive medical advice or treatment', partOfSpeech: 'noun', collocations: ['campus clinic', 'visit a clinic', 'nearby clinic'],
    examples: [['The campus clinic opens at eight in the morning.', '校园诊所早上八点开门。'], ['I visited a clinic when my fever did not improve.', '发烧没有好转时，我去了诊所。']],
  },
  {
    expression: 'prescription', sense: 'doctor-medicine-order', zh: '处方', definition: 'a written instruction from a doctor that allows medicine to be supplied', partOfSpeech: 'noun', collocations: ['get a prescription', 'prescription medicine', 'fill a prescription'],
    examples: [['The doctor gave me a prescription for antibiotics.', '医生给我开了抗生素处方。'], ['Take the prescription to the pharmacy downstairs.', '把处方拿到楼下的药房。']],
  },
  {
    expression: 'pharmacy', sense: 'medicine-shop', zh: '药房', definition: 'a shop or department where medicines are prepared and sold', partOfSpeech: 'noun', collocations: ['local pharmacy', 'hospital pharmacy', 'go to the pharmacy'],
    examples: [['The pharmacy closes at ten tonight.', '这家药房今晚十点关门。'], ['Ask the pharmacist at the pharmacy how to take the medicine.', '请向药房的药剂师询问如何服药。']],
  },
  {
    expression: 'fever', sense: 'high-body-temperature', zh: '发烧', definition: 'a medical condition in which the body temperature is higher than normal', partOfSpeech: 'noun', collocations: ['have a fever', 'high fever', 'reduce a fever'],
    examples: [['I stayed home because I had a fever.', '我因为发烧而待在家里。'], ['See a doctor if the fever lasts more than two days.', '如果发烧持续超过两天，请去看医生。']],
  },
  {
    expression: 'sore throat', sense: 'painful-throat', zh: '喉咙痛', definition: 'pain or irritation in the throat, especially when swallowing', partOfSpeech: 'noun phrase', collocations: ['have a sore throat', 'bad sore throat', 'soothe a sore throat'],
    examples: [['I have a sore throat and find it difficult to speak.', '我喉咙痛，说话很困难。'], ['Warm water helped soothe my sore throat.', '温水帮助缓解了我的喉咙痛。']],
  },
  {
    expression: 'health insurance', sense: 'medical-cost-cover', zh: '医疗保险', definition: 'insurance that pays for some or all medical costs', partOfSpeech: 'noun phrase', collocations: ['buy health insurance', 'health insurance policy', 'health insurance coverage'],
    examples: [['Check whether your health insurance covers the clinic visit.', '确认你的医疗保险是否承担诊所就诊费用。'], ['International students must keep their health insurance active.', '国际学生必须保持医疗保险有效。']],
  },
  {
    expression: 'emergency', sense: 'urgent-dangerous-situation', zh: '紧急情况', definition: 'a serious and unexpected situation requiring immediate action', partOfSpeech: 'noun', collocations: ['in an emergency', 'emergency contact', 'medical emergency'],
    examples: [['Call the campus security number in an emergency.', '遇到紧急情况时拨打校园保安电话。'], ['I saved my landlord as an emergency contact.', '我把房东存为紧急联系人。']],
  },
  {
    expression: 'passport', sense: 'international-travel-id', zh: '护照', definition: 'an official document used to prove identity and nationality when travelling', partOfSpeech: 'noun', collocations: ['valid passport', 'passport number', 'renew a passport'],
    examples: [['Keep a digital copy of your passport in a secure place.', '把护照的电子副本保存在安全的地方。'], ['My passport must remain valid throughout the semester.', '我的护照必须在整个学期内保持有效。']],
  },
  {
    expression: 'student visa', sense: 'permission-to-study-abroad', zh: '学生签证', definition: 'official permission to enter or remain in a country for study', partOfSpeech: 'noun phrase', collocations: ['apply for a student visa', 'student visa expiry', 'valid student visa'],
    examples: [['My student visa expires at the end of the year.', '我的学生签证在年底到期。'], ['The international office explained how to renew a student visa.', '国际学生办公室解释了如何续学生签证。']],
  },
  {
    expression: 'renewal', sense: 'extension-of-validity', zh: '续期', definition: 'the act of making an official document or agreement valid for a further period', partOfSpeech: 'noun', collocations: ['visa renewal', 'renewal application', 'renewal date'],
    examples: [['Start the visa renewal process before the expiry date.', '在到期日前开始签证续期流程。'], ['My tenancy renewal requires a new signature.', '我的租约续期需要重新签字。']],
  },
  {
    expression: 'bank account', sense: 'money-account-at-bank', zh: '银行账户', definition: 'an arrangement with a bank for keeping and managing money', partOfSpeech: 'noun phrase', collocations: ['open a bank account', 'bank account details', 'student bank account'],
    examples: [['I opened a bank account to receive scholarship payments.', '我开了一个银行账户来接收奖学金。'], ['Never share your bank account details or online-banking password.', '绝不要把银行账户详情或网银密码分享给任何人。']],
  },
  {
    expression: 'cashless payment', sense: 'electronic-payment', zh: '无现金支付', definition: 'payment made electronically rather than with notes or coins', partOfSpeech: 'noun phrase', collocations: ['accept cashless payment', 'cashless payment method', 'make a cashless payment'],
    examples: [['Most campus shops accept cashless payment.', '大多数校园商店接受无现金支付。'], ['I used a cashless payment when I bought lunch.', '我买午餐时使用了无现金支付。']],
  },
  {
    expression: 'transfer', sense: 'send-money-between-accounts', zh: '转账', definition: 'to move money from one bank account to another', partOfSpeech: 'verb', collocations: ['transfer money', 'bank transfer', 'transfer funds'],
    examples: [['I transfer my share of the rent to my flatmate each month.', '我每月把自己那份房租转给室友。'], ['Check the account number before you transfer money.', '转账前请核对账号。']],
  },
  {
    expression: 'mobile data', sense: 'phone-network-internet', zh: '移动数据流量', definition: 'internet access provided to a mobile phone through a cellular network', partOfSpeech: 'noun phrase', zhAnswers: ['手机流量'], collocations: ['use mobile data', 'mobile data plan', 'run out of mobile data'],
    examples: [['I use mobile data when the campus Wi-Fi is slow.', '校园无线网络慢时，我使用移动数据流量。'], ['Video calls can consume a lot of mobile data.', '视频通话可能消耗大量手机流量。']],
  },
  {
    expression: 'coverage', sense: 'mobile-network-availability', zh: '网络信号覆盖', definition: 'the area in which a mobile network service can be received', partOfSpeech: 'noun', collocations: ['network coverage', 'poor coverage', 'coverage area'],
    examples: [['Mobile coverage is weak inside this lecture hall.', '这间讲堂里的移动网络信号覆盖很弱。'], ['Check the provider\'s coverage before choosing a plan.', '选择套餐前查看运营商的信号覆盖。']],
  },
  {
    expression: 'Wi-Fi', sense: 'wireless-internet', zh: '无线网络', definition: 'wireless local-area networking technology based on IEEE 802.11 standards', partOfSpeech: 'noun', variants: ['wifi', 'WiFi'], collocations: ['connect to Wi-Fi', 'campus Wi-Fi', 'Wi-Fi password'],
    examples: [['The Wi-Fi password is printed at the reception desk.', '无线网络密码印在接待处。'], ['I connected to the campus Wi-Fi before downloading the slides.', '下载幻灯片前，我连接了校园无线网络。']],
  },
  {
    expression: 'charger', sense: 'device-for-charging-battery', zh: '充电器', definition: 'a device used to put electrical power into a battery', partOfSpeech: 'noun', collocations: ['phone charger', 'laptop charger', 'borrow a charger'],
    examples: [['I left my laptop charger in the library.', '我把笔记本电脑充电器落在图书馆了。'], ['Could I borrow your charger for ten minutes?', '我可以借你的充电器十分钟吗？']],
  },
  {
    expression: 'laundry', sense: 'clothes-to-be-washed', zh: '待洗衣物', definition: 'clothes and other items that need to be washed or have just been washed', partOfSpeech: 'noun', zhAnswers: ['洗衣'], collocations: ['do the laundry', 'laundry room', 'laundry basket'],
    examples: [['I usually do my laundry on Sunday evening.', '我通常周日晚上洗衣服。'], ['The laundry room uses cashless payment.', '洗衣房使用无现金支付。']],
  },
  {
    expression: 'groceries', sense: 'regular-food-and-household-shopping', zh: '日常食品杂货', definition: 'food and household items bought regularly from a shop', partOfSpeech: 'plural noun', zhAnswers: ['生活杂货'], collocations: ['buy groceries', 'grocery shopping', 'weekly groceries'],
    examples: [['We buy groceries together to save delivery fees.', '我们一起购买日常食品杂货，以节省配送费。'], ['I made a list before shopping for groceries.', '购买食品杂货前我列了清单。']],
  },
  {
    expression: 'budget', sense: 'personal-spending-plan', zh: '个人预算', definition: 'a plan showing how much money is available and how it will be spent', partOfSpeech: 'noun', collocations: ['set a budget', 'monthly budget', 'stay within budget'],
    examples: [['My monthly budget includes rent, food, and transport.', '我的月度预算包括房租、食物和交通。'], ['Cooking at home helps me stay within budget.', '在家做饭帮助我控制在预算内。']],
  },
  {
    expression: 'affordable', sense: 'not-too-expensive', zh: '价格负担得起的', definition: 'cheap enough for someone to be able to pay for', partOfSpeech: 'adjective', zhAnswers: ['实惠的'], collocations: ['affordable rent', 'affordable meal', 'reasonably affordable'],
    examples: [['This café serves affordable student meals.', '这家咖啡馆提供学生负担得起的餐食。'], ['We found an affordable room near the train station.', '我们在火车站附近找到了一间价格实惠的房间。']],
  },
  {
    expression: 'catch up', sense: 'exchange-recent-news', zh: '叙旧并了解近况', definition: 'to talk with someone you know and share recent news', partOfSpeech: 'phrasal verb', collocations: ['catch up with a friend', 'catch up over lunch', 'time to catch up'],
    examples: [['Let\'s catch up over lunch after the lecture.', '讲座课后我们边吃午饭边聊聊近况吧。'], ['I called an old classmate to catch up.', '我打电话给一位老同学叙旧。']],
  },
  {
    expression: 'hang out', sense: 'spend-relaxed-time-together', zh: '一起休闲相处', definition: 'to spend time relaxing or socialising with someone', partOfSpeech: 'phrasal verb', zhAnswers: ['一起玩'], collocations: ['hang out with friends', 'hang out after class', 'place to hang out'],
    examples: [['We often hang out at the café after class.', '我们经常课后在咖啡馆一起休闲。'], ['Would you like to hang out this weekend?', '你这个周末想一起玩吗？']],
  },
  {
    expression: 'introduce', sense: 'present-person-by-name', zh: '介绍认识', definition: 'to tell people each other\'s names so that they meet for the first time', partOfSpeech: 'verb', collocations: ['introduce yourself', 'introduce someone to someone', 'briefly introduce'],
    examples: [['Let me introduce you to my project partner.', '让我介绍你认识我的项目搭档。'], ['The lecturer asked everyone to introduce themselves.', '讲师请每个人做自我介绍。']],
  },
  {
    expression: 'recommend', sense: 'suggest-as-good', zh: '推荐', definition: 'to suggest that someone or something would be a good choice', partOfSpeech: 'verb', collocations: ['highly recommend', 'recommend a place', 'recommend doing something'],
    examples: [['Can you recommend a quiet place to study?', '你能推荐一个安静的学习地点吗？'], ['My coursemate recommended taking the early train.', '我的同学建议乘早班火车。']],
  },
  {
    expression: 'clarify', sense: 'make-clearer', zh: '澄清说明', definition: 'to make something easier to understand by explaining it more clearly', partOfSpeech: 'verb', zhAnswers: ['讲清楚'], collocations: ['clarify a point', 'clarify the requirements', 'ask someone to clarify'],
    examples: [['Could you clarify the second requirement?', '你可以讲清楚第二项要求吗？'], ['The tutor clarified how marks would be awarded.', '导师说明了分数如何评定。']],
  },
  {
    expression: 'apologise', sense: 'say-sorry-uk', zh: '道歉', definition: 'to say that you are sorry for something you have done', partOfSpeech: 'verb', variants: ['apologize'], collocations: ['apologise for being late', 'sincerely apologise', 'apologise to someone'],
    examples: [['I apologise for replying so late.', '我为这么晚回复而道歉。'], ['She apologised to the group for missing the meeting.', '她因错过会议向小组道歉。']],
  },
  {
    expression: 'appreciate', sense: 'be-grateful-for', zh: '感激', definition: 'to be grateful for something that someone has done', partOfSpeech: 'verb', collocations: ['really appreciate', 'appreciate your help', 'greatly appreciate'],
    examples: [['I appreciate your help with the registration form.', '我很感激你帮我填写注册表。'], ['We appreciate the lecturer\'s clear feedback.', '我们感谢讲师清晰的反馈。']],
  },
  {
    expression: 'convenient', sense: 'easy-and-suitable', zh: '方便的', definition: 'easy to use or suitable for a particular purpose or time', partOfSpeech: 'adjective', collocations: ['convenient location', 'convenient time', 'more convenient'],
    examples: [['The station is in a convenient location near campus.', '车站位于校园附近一个方便的位置。'], ['Online payment is convenient when I do not have cash.', '没有现金时，在线支付很方便。']],
  },
  {
    expression: 'available', sense: 'free-to-meet', zh: '有空的', definition: 'free to meet someone or do something at a particular time', partOfSpeech: 'adjective', collocations: ['available tomorrow', 'available for a meeting', 'available in the afternoon'],
    examples: [['Are you available for a project meeting at four?', '你四点有空参加项目会议吗？'], ['The lecturer is available in the afternoon for questions.', '讲师下午有空回答问题。']],
  },
  {
    expression: 'crowded', sense: 'full-of-people', zh: '拥挤的', definition: 'containing too many people in a small space', partOfSpeech: 'adjective', collocations: ['very crowded', 'crowded train', 'crowded place'],
    examples: [['The train is crowded during the evening rush hour.', '晚高峰期间火车很拥挤。'], ['We chose a less crowded place for our discussion.', '我们选择了一个不那么拥挤的地方讨论。']],
  },
  {
    expression: 'humid', sense: 'warm-and-moist-air', zh: '潮湿闷热的', definition: 'having a lot of moisture in the air, often making it feel hot', partOfSpeech: 'adjective', collocations: ['hot and humid', 'humid weather', 'very humid'],
    examples: [['The weather is hot and humid this afternoon.', '今天下午天气闷热潮湿。'], ['My clothes take longer to dry when it is humid.', '天气潮湿时，我的衣服需要更久才能干。']],
  },
  {
    expression: 'nearby', sense: 'not-far-away', zh: '附近的', definition: 'not far away from a particular place', partOfSpeech: 'adjective', collocations: ['nearby shop', 'nearby station', 'nearby area'],
    examples: [['Is there a nearby shop that sells chargers?', '附近有卖充电器的商店吗？'], ['We walked to a nearby café after class.', '课后我们步行去了一家附近的咖啡馆。']],
  },
  {
    expression: 'borrow', sense: 'take-temporarily-from-someone', zh: '借入', definition: 'to take and use something belonging to someone else and return it later', partOfSpeech: 'verb', collocations: ['borrow a book', 'borrow from someone', 'borrow temporarily'],
    examples: [['May I borrow your calculator for the tutorial?', '辅导课上我可以借用你的计算器吗？'], ['Students can borrow laptops from the library.', '学生可以从图书馆借用笔记本电脑。']],
  },
  {
    expression: 'lend', sense: 'give-temporarily-to-someone', zh: '借出', definition: 'to give something to someone for a short time, expecting it to be returned', partOfSpeech: 'verb', collocations: ['lend someone a book', 'lend money', 'willing to lend'],
    examples: [['Could you lend me a pen for the attendance form?', '你能借给我一支笔填写出勤表吗？'], ['I never lend my bank card to anyone.', '我绝不会把银行卡借给任何人。']],
  },
  {
    expression: 'run out of', sense: 'use-all-and-have-none-left', zh: '用完', definition: 'to use all of something so that none remains', partOfSpeech: 'phrasal verb', collocations: ['run out of money', 'run out of data', 'run out of time'],
    examples: [['I do not want to run out of mobile data before the exam.', '我不想在考试前用完手机流量。'], ['We ran out of drinking water during the holiday.', '假日期间我们的饮用水用完了。']],
  },
  {
    expression: 'pick up', sense: 'collect-person-or-thing', zh: '接取', definition: 'to collect someone or something from a place', partOfSpeech: 'phrasal verb', zhAnswers: ['接人', '取东西'], collocations: ['pick up a parcel', 'pick someone up', 'pick up an order'],
    examples: [['I will pick up the parcel after my lecture.', '讲座课后我会去取包裹。'], ['My flatmate offered to pick me up at the station.', '我的室友提出去车站接我。']],
  },
  {
    expression: 'drop off', sense: 'take-to-place-and-leave', zh: '送到后离开', definition: 'to take someone or something to a place and leave them there', partOfSpeech: 'phrasal verb', collocations: ['drop someone off', 'drop off a parcel', 'drop-off point'],
    examples: [['The driver will drop off passengers at the main gate.', '司机会在正门让乘客下车。'], ['I need to drop off this form at the finance office.', '我需要把这份表格送到财务办公室。']],
  },
  {
    expression: 'look forward to', sense: 'feel-pleased-about-future', zh: '期待', definition: 'to feel pleased and excited about something that is going to happen', partOfSpeech: 'phrase', collocations: ['look forward to meeting', 'look forward to hearing', 'really look forward to'],
    examples: [['I look forward to meeting the new project team.', '我期待见到新的项目团队。'], ['We look forward to hearing your presentation.', '我们期待听你的演示汇报。']],
  },
  {
    expression: 'keep in touch', sense: 'continue-communicating', zh: '保持联系', definition: 'to continue communicating with someone after you are apart', partOfSpeech: 'phrase', collocations: ['keep in touch with friends', 'promise to keep in touch', 'keep in close touch'],
    examples: [['Let\'s keep in touch after the semester ends.', '学期结束后我们保持联系吧。'], ['I keep in touch with my internship supervisor by email.', '我通过电子邮件与实习主管保持联系。']],
  },
  {
    expression: 'take care', sense: 'friendly-goodbye', zh: '保重', definition: 'a friendly expression used when saying goodbye and wishing someone well', partOfSpeech: 'phrase', collocations: ['take care of yourself', 'take care on the way', 'please take care'],
    examples: [['Take care, and message me when you arrive.', '保重，到了以后给我发消息。'], ['Please take care on your journey home.', '回家路上请多保重。']],
  },
  {
    expression: 'make sure', sense: 'check-or-ensure', zh: '确保', definition: 'to check that something is true or to ensure that something happens', partOfSpeech: 'phrase', collocations: ['make sure that', 'make sure to', 'make absolutely sure'],
    examples: [['Make sure you attach the file before sending the email.', '确保发送邮件前附上文件。'], ['I called the clinic to make sure it was open.', '我打电话给诊所确认它在营业。']],
  },
  {
    expression: 'no worries', sense: 'friendly-reassurance', zh: '没关系；不用担心', definition: 'an informal expression used to say that there is no problem', partOfSpeech: 'phrase', zhAnswers: ['没问题'], collocations: ['no worries at all', 'say no worries', 'no worries about that'],
    examples: [['No worries, I can send the notes again.', '没关系，我可以再发一次笔记。'], ['No worries about the delay; the deadline has changed.', '不用担心延误；截止日期已经改了。']],
  },
  {
    expression: 'could you repeat that', sense: 'request-repetition', zh: '你可以再说一遍吗', definition: 'a polite request for someone to say the same thing again', partOfSpeech: 'phrase', variants: ['could you say that again'], collocations: ['politely ask someone to repeat', 'repeat that more slowly'],
    examples: [['Could you repeat that? The connection was unclear.', '你可以再说一遍吗？刚才连接不清楚。'], ['I said, “Could you repeat that?” when I missed the room number.', '我没听清房间号时说：“你可以再说一遍吗？”']],
  },
  {
    expression: 'what do you mean', sense: 'ask-for-explanation', zh: '你是什么意思', definition: 'a question used to ask someone to explain what they have said', partOfSpeech: 'phrase', collocations: ['ask what someone means', 'what exactly do you mean'],
    examples: [['What do you mean by “material difference”?', '你说的“重大差异”是什么意思？'], ['I asked, “What do you mean?” instead of pretending to understand.', '我问“你是什么意思？”，而没有假装听懂。']],
  },
  {
    expression: "I'm not sure", sense: 'express-uncertainty', zh: '我不确定', definition: 'a polite expression used when you do not know or are uncertain', partOfSpeech: 'phrase', variants: ['I am not sure'], collocations: ["I'm not sure whether", "I'm not sure about", "I'm really not sure"],
    examples: [["I'm not sure which bus goes to the campus.", '我不确定哪路公交车去校园。'], ["I'm not sure about the answer, so I will check the notes.", '我不确定答案，所以会查看笔记。']],
  },
  {
    expression: 'it depends', sense: 'answer-varies-by-condition', zh: '这要看情况', definition: 'an expression meaning that the answer changes according to the situation', partOfSpeech: 'phrase', collocations: ['it depends on', 'say it depends', 'it really depends'],
    examples: [['It depends on how much time we have before class.', '这要看上课前我们有多少时间。'], ['Whether I take the train or bus depends on the weather.', '我乘火车还是公交车要看天气。']],
  },
  {
    expression: 'settle in', sense: 'become-comfortable-in-new-place', zh: '适应新环境', definition: 'to become comfortable in a new place, job, or situation', partOfSpeech: 'phrasal verb', collocations: ['settle in quickly', 'help someone settle in', 'time to settle in'],
    examples: [['It took me a few weeks to settle in at university.', '我花了几周才适应大学生活。'], ['My coursemates helped me settle in after I arrived in Malaysia.', '我到马来西亚后，同学们帮助我适应新环境。']],
  },
]

const financeRows: SeedRow[] = [
  {
    expression: 'asset', sense: 'controlled-economic-resource', zh: '资产', definition: 'a present economic resource controlled by an entity as a result of past events', partOfSpeech: 'noun', collocations: ['recognise an asset', 'current asset', 'asset value'],
    examples: [['An asset must provide the entity with a potential economic benefit.', '资产必须能为主体带来潜在经济利益。'], ['Cash is usually reported as a current asset.', '现金通常列报为流动资产。']],
  },
  {
    expression: 'liability', sense: 'present-transfer-obligation', zh: '负债', definition: 'a present obligation of an entity to transfer an economic resource because of past events', partOfSpeech: 'noun', collocations: ['recognise a liability', 'current liability', 'settle a liability'],
    examples: [['A liability is recognised when the company has a present obligation.', '公司存在现时义务时确认负债。'], ['The unpaid supplier invoice creates a current liability.', '未支付的供应商发票形成一项流动负债。']],
  },
  {
    expression: 'equity', sense: 'residual-interest', zh: '所有者权益', definition: 'the residual interest in an entity\'s assets after deducting all liabilities', partOfSpeech: 'noun', zhAnswers: ['权益'], collocations: ['shareholders\' equity', 'total equity', 'equity balance'],
    examples: [['Equity increases when owners invest additional capital.', '所有者追加投入资本时，所有者权益增加。'], ['Retained earnings form part of the company\'s equity.', '留存收益构成公司所有者权益的一部分。']],
  },
  {
    expression: 'revenue', sense: 'ordinary-activity-income', zh: '营业收入', definition: 'income arising from an entity\'s ordinary activities', partOfSpeech: 'noun', zhAnswers: ['收入'], collocations: ['recognise revenue', 'sales revenue', 'revenue growth'],
    examples: [['Revenue is recognised when control of the service passes to the customer.', '服务的控制权转移给客户时确认营业收入。'], ['The subscription business reports revenue each month.', '这家订阅制企业每月报告收入。']],
  },
  {
    expression: 'expense', sense: 'decrease-in-economic-benefits', zh: '费用', definition: 'a decrease in assets or increase in liabilities that reduces equity, excluding owner distributions', partOfSpeech: 'noun', collocations: ['recognise an expense', 'operating expense', 'expense account'],
    examples: [['An expense is recognised when resources are consumed to earn revenue.', '为赚取收入而消耗资源时确认费用。'], ['Office rent is an operating expense for the company.', '办公室租金是公司的经营费用。']],
  },
  {
    expression: 'profit', sense: 'income-exceeds-expenses', zh: '利润', definition: 'the amount by which total income exceeds total expenses for a period', partOfSpeech: 'noun', collocations: ['earn a profit', 'profit margin', 'profit for the year'],
    examples: [['The business earned a profit after controlling its delivery costs.', '这家企业控制配送成本后获得了利润。'], ['Profit for the year is transferred to retained earnings.', '本年利润会转入留存收益。']],
  },
  {
    expression: 'loss', sense: 'expenses-exceed-income', zh: '亏损', definition: 'the amount by which expenses exceed income for a period or transaction', partOfSpeech: 'noun', collocations: ['report a loss', 'net loss', 'impairment loss'],
    examples: [['The company reported a loss during its first year of operation.', '公司在经营第一年报告了亏损。'], ['An impairment loss reduced the carrying amount of the equipment.', '减值损失降低了设备的账面金额。']],
  },
  {
    expression: 'cash flow', sense: 'movement-of-cash', zh: '现金流量', definition: 'the movement of cash and cash equivalents into or out of an entity', partOfSpeech: 'noun phrase', variants: ['cashflow'], collocations: ['operating cash flow', 'positive cash flow', 'cash flow forecast'],
    examples: [['Positive cash flow does not always mean the company is profitable.', '正现金流量并不总意味着公司盈利。'], ['The founder reviews cash flow every week before approving payments.', '创始人每周在批准付款前审查现金流。']],
  },
  {
    expression: 'accounts receivable', sense: 'customer-amounts-due', zh: '应收账款', definition: 'amounts owed to an entity by customers for goods or services supplied on credit', partOfSpeech: 'plural noun', variants: ['trade receivables'], collocations: ['collect accounts receivable', 'accounts receivable balance', 'ageing of receivables'],
    examples: [['Accounts receivable increase when customers buy on credit.', '客户赊购时，应收账款增加。'], ['The accountant reviews overdue accounts receivable each Friday.', '会计每周五审查逾期应收账款。']],
  },
  {
    expression: 'accounts payable', sense: 'supplier-amounts-due', zh: '应付账款', definition: 'amounts an entity owes suppliers for goods or services received on credit', partOfSpeech: 'plural noun', variants: ['trade payables'], collocations: ['settle accounts payable', 'accounts payable balance', 'accounts payable department'],
    examples: [['Accounts payable are normally presented as current liabilities.', '应付账款通常列报为流动负债。'], ['The accounts payable team matches each invoice to a purchase order.', '应付账款团队把每张发票与采购订单匹配。']],
  },
  {
    expression: 'inventory', sense: 'goods-held-for-sale-or-production', zh: '存货', definition: 'assets held for sale, being produced for sale, or used in producing goods or services', partOfSpeech: 'noun', collocations: ['measure inventory', 'inventory count', 'closing inventory'],
    examples: [['Inventory is measured at the lower of cost and net realisable value.', '存货按成本与可变现净值孰低计量。'], ['The retailer performs an inventory count at year-end.', '零售商在年末进行存货盘点。']],
  },
  {
    expression: 'depreciation', sense: 'tangible-asset-cost-allocation', zh: '折旧', definition: 'the systematic allocation of a tangible asset\'s depreciable amount over its useful life', partOfSpeech: 'noun', collocations: ['charge depreciation', 'depreciation expense', 'straight-line depreciation'],
    examples: [['Depreciation spreads the depreciable amount over the asset\'s useful life.', '折旧将应折旧金额分摊到资产的使用寿命内。'], ['The company uses straight-line depreciation for office equipment.', '公司对办公设备采用直线法折旧。']],
  },
  {
    expression: 'amortisation', sense: 'intangible-asset-cost-allocation', zh: '摊销', definition: 'the systematic allocation of an intangible asset\'s depreciable amount over its useful life', partOfSpeech: 'noun', variants: ['amortization'], collocations: ['amortisation expense', 'amortisation period', 'charge amortisation'],
    examples: [['Amortisation begins when the software is available for use.', '软件达到可使用状态时开始摊销。'], ['The licence has a five-year amortisation period.', '该许可证的摊销期为五年。']],
  },
  {
    expression: 'accrual', sense: 'earned-or-incurred-before-cash', zh: '应计项目', definition: 'income earned or an expense incurred before the related cash is received or paid', partOfSpeech: 'noun', collocations: ['record an accrual', 'expense accrual', 'accrual accounting'],
    examples: [['The accountant records an accrual for electricity used but not yet billed.', '会计对已使用但尚未开票的电费记录应计项目。'], ['An accrual ensures the expense is reported in the correct period.', '应计项目确保费用列报在正确期间。']],
  },
  {
    expression: 'prepayment', sense: 'payment-before-benefit', zh: '预付款项', definition: 'a payment made before the related goods or services are received or consumed', partOfSpeech: 'noun', zhAnswers: ['预付费用'], collocations: ['record a prepayment', 'insurance prepayment', 'prepayment balance'],
    examples: [['The annual insurance payment is initially recorded as a prepayment.', '年度保险费最初记录为预付款项。'], ['Part of the rent prepayment becomes an expense each month.', '预付租金的一部分每月转为费用。']],
  },
  {
    expression: 'provision', sense: 'uncertain-liability', zh: '预计负债', definition: 'a liability whose timing or amount is uncertain', partOfSpeech: 'noun', collocations: ['recognise a provision', 'warranty provision', 'measure a provision'],
    examples: [['A provision is recognised when an outflow is probable and can be estimated reliably.', '经济利益很可能流出且金额能可靠估计时确认预计负债。'], ['The company measured a provision for product warranties.', '公司计量了一项产品保修预计负债。']],
  },
  {
    expression: 'impairment', sense: 'asset-value-reduction', zh: '减值', definition: 'a recognised reduction in an asset\'s carrying amount; for many non-financial assets under IAS 36, it arises when carrying amount exceeds recoverable amount', partOfSpeech: 'noun', collocations: ['impairment test', 'impairment loss', 'recognise impairment'],
    examples: [['The impairment test showed that the machine could not recover its carrying amount.', '减值测试显示该机器无法收回其账面金额。'], ['The entity recognised impairment after demand for the product fell sharply.', '产品需求大幅下降后，主体确认了减值。']],
  },
  {
    expression: 'carrying amount', sense: 'recognised-statement-amount', zh: '账面金额', definition: 'the amount at which an asset or liability is recognised after relevant deductions or adjustments', partOfSpeech: 'noun phrase', variants: ['book value'], collocations: ['carrying amount of an asset', 'reduce the carrying amount', 'compare carrying amount'],
    examples: [['The carrying amount includes cost less accumulated depreciation and impairment.', '账面金额包括成本减累计折旧和减值。'], ['The accountant compared the carrying amount with the recoverable amount.', '会计把账面金额与可收回金额进行比较。']],
  },
  {
    expression: 'fair value', sense: 'market-participant-exit-price', zh: '公允价值', definition: 'the price to sell an asset or transfer a liability in an orderly transaction between market participants', partOfSpeech: 'noun phrase', collocations: ['measure at fair value', 'fair value hierarchy', 'fair value gain'],
    examples: [['Fair value reflects assumptions that market participants would use.', '公允价值反映市场参与者会使用的假设。'], ['The quoted market price provides evidence of fair value.', '公开市场报价为公允价值提供证据。']],
  },
  {
    expression: 'historical cost', sense: 'original-transaction-based-measurement', zh: '历史成本', definition: 'a measurement based mainly on the price paid or received when a transaction occurred', partOfSpeech: 'noun phrase', collocations: ['measure at historical cost', 'historical cost basis', 'historical cost information'],
    examples: [['Historical cost records equipment at the amount paid to acquire it.', '历史成本按取得设备时支付的金额记录设备。'], ['Transaction records support the historical cost of the building.', '交易记录支持该建筑物的历史成本。']],
  },
  {
    expression: 'materiality', sense: 'decision-influencing-significance', zh: '重要性', definition: 'the quality of information whose omission or misstatement could reasonably influence users\' decisions', partOfSpeech: 'noun', collocations: ['assess materiality', 'materiality threshold', 'overall materiality'],
    examples: [['Materiality depends on the nature or magnitude of the information.', '重要性取决于信息的性质或金额大小。'], ['The auditor set a lower materiality threshold for sensitive disclosures.', '审计师为敏感披露设定了较低的重要性水平。']],
  },
  {
    expression: 'going concern', sense: 'continued-operation-assumption', zh: '持续经营', definition: 'the assumption that an entity will continue operating for the foreseeable future', partOfSpeech: 'noun phrase', collocations: ['going concern assumption', 'going concern assessment', 'material going concern uncertainty'],
    examples: [['Management must assess going concern when preparing the financial statements.', '管理层编制财务报表时必须评估持续经营。'], ['A severe cash shortage may create a going concern uncertainty.', '严重现金短缺可能造成持续经营的不确定性。']],
  },
  {
    expression: 'double-entry bookkeeping', sense: 'balanced-two-sided-recording', zh: '复式记账', definition: 'a system in which every transaction is recorded with equal debit and credit entries', partOfSpeech: 'noun phrase', variants: ['double-entry accounting'], collocations: ['use double-entry bookkeeping', 'double-entry bookkeeping system', 'principle of double entry'],
    examples: [['Double-entry bookkeeping keeps total debits equal to total credits.', '复式记账使借方总额等于贷方总额。'], ['The software applies double-entry bookkeeping to every transaction.', '该软件对每笔交易采用复式记账。']],
  },
  {
    expression: 'debit', sense: 'left-side-account-entry', zh: '借方记录', definition: 'an entry on the left side of an account', partOfSpeech: 'noun', zhAnswers: ['借方'], collocations: ['record a debit', 'debit entry', 'debit balance'],
    examples: [['A debit to cash records an increase in that asset account.', '现金账户的借方记录该资产账户的增加。'], ['The journal entry includes a debit for the equipment purchased.', '该会计分录包括所购设备的借方记录。']],
  },
  {
    expression: 'credit', sense: 'right-side-account-entry', zh: '贷方记录', definition: 'an entry on the right side of an account', partOfSpeech: 'noun', zhAnswers: ['贷方'], collocations: ['record a credit', 'credit entry', 'credit balance'],
    examples: [['A credit to revenue records an increase in income.', '收入账户的贷方记录收入的增加。'], ['Paying a supplier creates a credit entry in the cash account.', '向供应商付款会在现金账户形成一笔贷方记录。']],
  },
  {
    expression: 'journal entry', sense: 'transaction-record-with-debits-credits', zh: '会计分录', definition: 'a record of a transaction showing the accounts and debit and credit amounts affected', partOfSpeech: 'noun phrase', collocations: ['record a journal entry', 'adjusting journal entry', 'post a journal entry'],
    examples: [['The journal entry debits rent expense and credits cash.', '这笔会计分录借记租金费用并贷记现金。'], ['The accountant reviewed each journal entry before posting it.', '会计在过账前复核每笔会计分录。']],
  },
  {
    expression: 'general ledger', sense: 'complete-set-of-accounts', zh: '总分类账', definition: 'the complete collection of accounts used to record an entity\'s transactions', partOfSpeech: 'noun phrase', variants: ['ledger'], collocations: ['post to the general ledger', 'general ledger account', 'general ledger balance'],
    examples: [['The general ledger contains separate accounts for cash, sales, and expenses.', '总分类账包含现金、销售和费用等独立账户。'], ['The system posts approved journal entries to the general ledger.', '系统把已批准的会计分录过入总分类账。']],
  },
  {
    expression: 'trial balance', sense: 'list-of-ledger-balances', zh: '试算平衡表', definition: 'a list of ledger account balances used to check whether total debits equal total credits', partOfSpeech: 'noun phrase', collocations: ['prepare a trial balance', 'adjusted trial balance', 'trial balance totals'],
    examples: [['The trial balance confirms that total debits equal total credits.', '试算平衡表确认借方总额等于贷方总额。'], ['An equal trial balance does not prove that every transaction is correct.', '试算平衡表平衡并不能证明每笔交易都正确。']],
  },
  {
    expression: 'financial statements', sense: 'formal-financial-reports', zh: '财务报表', definition: 'formal reports presenting an entity\'s financial position, performance, and cash flows', partOfSpeech: 'plural noun', collocations: ['prepare financial statements', 'audited financial statements', 'annual financial statements'],
    examples: [['Financial statements help investors assess the company\'s performance and position.', '财务报表帮助投资者评估公司的业绩和状况。'], ['The notes form an integral part of the financial statements.', '附注是财务报表不可分割的一部分。']],
  },
  {
    expression: 'statement of financial position', sense: 'assets-liabilities-equity-report', zh: '财务状况表', definition: 'a financial statement showing an entity\'s assets, liabilities, and equity at a specific date', partOfSpeech: 'noun phrase', variants: ['balance sheet'], collocations: ['prepare a statement of financial position', 'statement of financial position date', 'present on the statement of financial position'],
    examples: [['The statement of financial position reports assets and liabilities at year-end.', '财务状况表列报年末的资产和负债。'], ['Cash appears as a current asset in the statement of financial position.', '现金在财务状况表中列为流动资产。']],
  },
  {
    expression: 'income statement', sense: 'profit-and-loss-report', zh: '利润表', definition: 'a financial statement presenting income, expenses, and profit or loss for a period', partOfSpeech: 'noun phrase', variants: ['statement of profit or loss', 'profit and loss statement', 'P&L statement'], collocations: ['prepare an income statement', 'income statement line item', 'income statement analysis'],
    examples: [['The income statement shows whether the business made a profit during the year.', '利润表显示企业本年度是否盈利。'], ['Revenue appears near the top of the income statement.', '营业收入列在利润表靠上的位置。']],
  },
  {
    expression: 'statement of cash flows', sense: 'cash-movement-report', zh: '现金流量表', definition: 'a financial statement classifying cash flows as operating, investing, and financing activities', partOfSpeech: 'noun phrase', variants: ['cash flow statement'], collocations: ['prepare a statement of cash flows', 'statement of cash flows analysis', 'operating section of the statement of cash flows'],
    examples: [['The statement of cash flows explains changes in cash during the period.', '现金流量表解释本期现金的变动。'], ['Loan proceeds appear under financing activities in the statement of cash flows.', '借款所得在现金流量表的筹资活动中列示。']],
  },
  {
    expression: 'retained earnings', sense: 'accumulated-undistributed-profit', zh: '留存收益', definition: 'accumulated profits kept in an entity after dividends and other distributions', partOfSpeech: 'plural noun', collocations: ['increase retained earnings', 'retained earnings balance', 'opening retained earnings'],
    examples: [['Retained earnings increase when profit is kept in the company.', '利润留在公司时，留存收益增加。'], ['A dividend reduces retained earnings when it is declared.', '股利宣告时会减少留存收益。']],
  },
  {
    expression: 'share capital', sense: 'owner-contributed-share-funds', zh: '股本', definition: 'equity capital arising from shares issued by a company; under Malaysia’s Companies Act 2016 shares generally have no par value, so share capital is not defined by a nominal/par amount', partOfSpeech: 'noun phrase', collocations: ['issue share capital', 'ordinary share capital', 'paid-up share capital'],
    examples: [['Share capital increased when the company issued new ordinary shares.', '公司发行新的普通股时，股本增加。'], ['The statement of changes in equity reports movements in share capital.', '权益变动表报告股本的变动。']],
  },
  {
    expression: 'dividend', sense: 'distribution-to-shareholders', zh: '股利', definition: 'a distribution of a company\'s profits or reserves to its shareholders', partOfSpeech: 'noun', zhAnswers: ['股息'], collocations: ['declare a dividend', 'pay a dividend', 'dividend per share'],
    examples: [['The board declared a dividend after reviewing available profits.', '董事会审查可供分配利润后宣告了股利。'], ['A growing company may retain cash instead of paying a dividend.', '成长型公司可能保留现金而不支付股利。']],
  },
  {
    expression: 'cost of sales', sense: 'cost-of-goods-or-services-sold', zh: '销售成本', definition: 'the direct cost of the goods or services that generated sales during a period', partOfSpeech: 'noun phrase', variants: ['cost of goods sold', 'COGS'], collocations: ['calculate cost of sales', 'cost of sales percentage', 'deduct cost of sales'],
    examples: [['Cost of sales includes the cost of inventory sold during the period.', '销售成本包括本期已售存货的成本。'], ['The retailer deducted cost of sales from revenue to calculate gross profit.', '零售商从营业收入中扣除销售成本以计算毛利。']],
  },
  {
    expression: 'gross profit', sense: 'revenue-less-cost-of-sales', zh: '毛利', definition: 'revenue minus cost of sales before operating and other expenses', partOfSpeech: 'noun phrase', collocations: ['calculate gross profit', 'gross profit margin', 'increase gross profit'],
    examples: [['Gross profit equals revenue less cost of sales.', '毛利等于营业收入减销售成本。'], ['Higher supplier prices reduced the shop\'s gross profit.', '供应商价格上涨降低了商店的毛利。']],
  },
  {
    expression: 'operating profit', sense: 'profit-from-operations', zh: '营业利润', definition: 'profit from an entity\'s operations, generally measured before finance costs and income tax; its exact composition may vary by entity', partOfSpeech: 'noun phrase', collocations: ['calculate operating profit', 'operating profit margin', 'increase operating profit'],
    examples: [['Operating profit improved after the company reduced administrative expenses.', '公司降低管理费用后，营业利润有所改善。'], ['The analyst compared operating profit across three years.', '分析师比较了三年的营业利润。']],
  },
  {
    expression: 'net profit', sense: 'profit-after-all-expenses', zh: '净利润', definition: 'profit remaining after all expenses, finance costs, and taxes are deducted', partOfSpeech: 'noun phrase', collocations: ['report net profit', 'net profit margin', 'increase net profit'],
    examples: [['Net profit fell because interest expense and tax increased.', '由于利息费用和税费增加，净利润下降。'], ['Investors examined the company\'s net profit margin.', '投资者考察了公司的净利润率。']],
  },
  {
    expression: 'working capital', sense: 'current-assets-less-current-liabilities', zh: '营运资本', definition: 'the difference between current assets and current liabilities', partOfSpeech: 'noun phrase', collocations: ['manage working capital', 'positive working capital', 'working capital requirement'],
    examples: [['Working capital is calculated as current assets minus current liabilities.', '营运资本按流动资产减流动负债计算。'], ['Slow customer payments can create working capital pressure.', '客户付款缓慢会造成营运资本压力。']],
  },
  {
    expression: 'current ratio', sense: 'short-term-liquidity-ratio', zh: '流动比率', definition: 'current assets divided by current liabilities, used to assess short-term liquidity', partOfSpeech: 'noun phrase', collocations: ['calculate the current ratio', 'current ratio of two', 'improve the current ratio'],
    examples: [['The current ratio compares current assets with current liabilities.', '流动比率比较流动资产与流动负债。'], ['A falling current ratio may indicate tighter short-term liquidity.', '流动比率下降可能表明短期流动性趋紧。']],
  },
  {
    expression: 'liquidity', sense: 'ability-to-meet-short-term-obligations', zh: '流动性', definition: 'the ability to obtain cash and meet short-term obligations when they fall due', partOfSpeech: 'noun', collocations: ['manage liquidity', 'liquidity risk', 'short-term liquidity'],
    examples: [['Liquidity is essential for paying suppliers and employees on time.', '流动性对于按时支付供应商和员工款项至关重要。'], ['The cash forecast revealed a liquidity shortage next month.', '现金预测显示下个月存在流动性短缺。']],
  },
  {
    expression: 'solvency', sense: 'ability-to-meet-long-term-obligations', zh: '偿债能力', definition: 'the ability of an entity to meet its long-term financial obligations', partOfSpeech: 'noun', collocations: ['assess solvency', 'long-term solvency', 'solvency ratio'],
    examples: [['Solvency focuses on whether the company can meet long-term obligations.', '偿债能力关注公司能否履行长期义务。'], ['Heavy borrowing may weaken the firm\'s solvency.', '大量借款可能削弱公司的长期偿债能力。']],
  },
  {
    expression: 'leverage', sense: 'use-of-borrowed-finance', zh: '财务杠杆', definition: 'the use of debt financing to increase the potential return to owners', partOfSpeech: 'noun', collocations: ['financial leverage', 'high leverage', 'leverage ratio'],
    examples: [['Leverage can increase both returns and financial risk.', '财务杠杆可能同时放大回报和财务风险。'], ['The lender was concerned about the company\'s high leverage.', '贷款方担心公司的高财务杠杆。']],
  },
  {
    expression: 'interest expense', sense: 'borrowing-finance-cost', zh: '利息费用', definition: 'the cost recognised for using borrowed money during a period', partOfSpeech: 'noun phrase', collocations: ['record interest expense', 'annual interest expense', 'interest expense on a loan'],
    examples: [['Interest expense is recognised over the period in which funds are borrowed.', '利息费用在借款资金使用期间确认。'], ['Higher rates increased the company\'s interest expense.', '利率上升增加了公司的利息费用。']],
  },
  {
    expression: 'principal', sense: 'original-borrowed-amount', zh: '本金', definition: 'the original amount of money borrowed or invested, excluding interest', partOfSpeech: 'noun', collocations: ['repay the principal', 'principal amount', 'principal and interest'],
    examples: [['The borrower repays part of the principal each month.', '借款人每月偿还一部分本金。'], ['Interest is calculated on the outstanding principal.', '利息按未偿还本金计算。']],
  },
  {
    expression: 'loan', sense: 'borrowed-sum-to-repay', zh: '贷款', definition: 'money provided by a lender that must be repaid, usually with interest', partOfSpeech: 'noun', collocations: ['take out a loan', 'repay a loan', 'bank loan'],
    examples: [['The business used a loan to purchase delivery equipment.', '企业用贷款购买配送设备。'], ['Read the repayment terms before accepting the loan.', '接受贷款前先阅读还款条款。']],
  },
  {
    expression: 'interest rate', sense: 'percentage-cost-or-return', zh: '利率', definition: 'the percentage charged on borrowed money or earned on invested money over a period', partOfSpeech: 'noun phrase', collocations: ['fixed interest rate', 'variable interest rate', 'raise interest rates'],
    examples: [['A variable interest rate may change during the life of the loan.', '浮动利率可能在贷款期限内发生变化。'], ['The bank quoted an annual interest rate of five per cent.', '银行报出的年利率为百分之五。']],
  },
  {
    expression: 'compound interest', sense: 'interest-on-principal-and-interest', zh: '复利', definition: 'interest calculated on both the original principal and accumulated interest', partOfSpeech: 'noun phrase', collocations: ['calculate compound interest', 'compound interest rate', 'earn compound interest'],
    examples: [['Compound interest allows past interest to earn further interest.', '复利使过去的利息也能继续产生利息。'], ['Long investment periods make compound interest more powerful.', '较长的投资期会增强复利效应。']],
  },
  {
    expression: 'present value', sense: 'current-value-of-future-cash', zh: '现值', definition: 'the current value of a future cash flow after discounting it at an appropriate rate', partOfSpeech: 'noun phrase', collocations: ['calculate present value', 'present value of cash flows', 'discounted present value'],
    examples: [['Present value reflects the time value of money.', '现值反映货币的时间价值。'], ['The analyst calculated the present value of the lease payments.', '分析师计算了租赁付款的现值。']],
  },
  {
    expression: 'future value', sense: 'later-value-after-growth', zh: '终值', definition: 'the amount that a present sum will grow to at a specified future date', partOfSpeech: 'noun phrase', zhAnswers: ['未来价值'], collocations: ['calculate future value', 'future value factor', 'future value of an investment'],
    examples: [['Future value shows how much today\'s investment may become later.', '终值显示今天的投资未来可能增长到多少。'], ['We calculated the future value using annual compounding.', '我们用年度复利计算了终值。']],
  },
  {
    expression: 'discount rate', sense: 'rate-for-present-value', zh: '折现率', definition: 'the rate used to convert future cash flows into present value', partOfSpeech: 'noun phrase', collocations: ['choose a discount rate', 'appropriate discount rate', 'higher discount rate'],
    examples: [['A higher discount rate reduces the present value of future cash flows.', '较高的折现率会降低未来现金流的现值。'], ['The project team chose a discount rate that reflected its risk.', '项目团队选择了能反映项目风险的折现率。']],
  },
  {
    expression: 'net present value', sense: 'discounted-inflows-less-outflows', zh: '净现值', definition: 'the present value of expected cash inflows minus the present value of cash outflows', partOfSpeech: 'noun phrase', variants: ['NPV'], collocations: ['calculate net present value', 'positive net present value', 'net present value analysis'],
    examples: [['A positive net present value suggests that a project may add value.', '正的净现值表明项目可能创造价值。'], ['Management compared the net present value of two investment options.', '管理层比较了两个投资方案的净现值。']],
  },
  {
    expression: 'internal rate of return', sense: 'zero-npv-discount-rate', zh: '内部收益率', definition: 'the discount rate at which an investment\'s net present value equals zero', partOfSpeech: 'noun phrase', variants: ['IRR'], collocations: ['calculate internal rate of return', 'project internal rate of return', 'compare internal rates of return'],
    examples: [['The internal rate of return is the rate that makes net present value zero.', '内部收益率是使净现值等于零的折现率。'], ['The investor compared the internal rate of return with the required return.', '投资者将内部收益率与必要报酬率比较。']],
  },
  {
    expression: 'return on investment', sense: 'gain-relative-to-investment', zh: '投资回报率', definition: 'a measure comparing the gain or benefit from an investment with its cost', partOfSpeech: 'noun phrase', variants: ['ROI'], collocations: ['calculate return on investment', 'high return on investment', 'improve return on investment'],
    examples: [['Return on investment compares a gain with the amount invested.', '投资回报率将收益与投入金额进行比较。'], ['The founder measured the return on investment from the marketing campaign.', '创始人衡量了营销活动的投资回报率。']],
  },
  {
    expression: 'risk', sense: 'uncertainty-of-financial-outcome', zh: '风险', definition: 'uncertainty about an outcome, including the possibility of financial loss', partOfSpeech: 'noun', collocations: ['assess risk', 'financial risk', 'risk tolerance'],
    examples: [['Risk increases when future cash flows are uncertain.', '未来现金流不确定时，风险会上升。'], ['The investor assessed the risk before buying the bond.', '投资者在购买债券前评估了风险。']],
  },
  {
    expression: 'diversification', sense: 'spreading-investments', zh: '分散投资', definition: 'spreading investments across different assets to reduce exposure to a single source of risk', partOfSpeech: 'noun', collocations: ['portfolio diversification', 'benefits of diversification', 'achieve diversification'],
    examples: [['Diversification reduces dependence on one company or industry.', '分散投资降低了对单一公司或行业的依赖。'], ['The fund achieved diversification by holding shares and bonds.', '该基金通过持有股票和债券实现了分散投资。']],
  },
  {
    expression: 'portfolio', sense: 'collection-of-investments', zh: '投资组合', definition: 'a collection of investments owned by an individual or organisation', partOfSpeech: 'noun', collocations: ['investment portfolio', 'manage a portfolio', 'diversified portfolio'],
    examples: [['The portfolio contains Malaysian shares, global funds, and bonds.', '该投资组合包含马来西亚股票、全球基金和债券。'], ['She reviews her portfolio whenever her investment goals change.', '每当投资目标改变时，她都会审查投资组合。']],
  },
  {
    expression: 'bond', sense: 'debt-security', zh: '债券', definition: 'a debt security under which an issuer promises repayment of principal and may provide coupons or another form of return', partOfSpeech: 'noun', collocations: ['issue a bond', 'government bond', 'bond yield'],
    examples: [['A bond generally requires the issuer to repay principal at maturity.', '债券通常要求发行人在到期时偿还本金。'], ['The investor bought a government bond for stable income.', '投资者购买政府债券以获得稳定收入。']],
  },
  {
    expression: 'share', sense: 'unit-of-company-ownership', zh: '股份', definition: 'a unit representing ownership in a company', partOfSpeech: 'noun', zhAnswers: ['股票'], collocations: ['ordinary share', 'buy a share', 'share price'],
    examples: [['Each share gives its owner a proportionate interest in the company.', '每一股份给予其持有人相应比例的公司权益。'], ['The share price rose after the company announced strong results.', '公司公布强劲业绩后，股价上涨。']],
  },
  {
    expression: 'market capitalisation', sense: 'listed-equity-market-value', zh: '市值', definition: 'the total market value of a company\'s outstanding shares', partOfSpeech: 'noun phrase', variants: ['market capitalization', 'market cap'], collocations: ['calculate market capitalisation', 'large market capitalisation', 'market capitalisation ranking'],
    examples: [['Market capitalisation equals the share price multiplied by shares outstanding.', '市值等于股价乘以流通在外股份数。'], ['The company\'s market capitalisation increased after its share price rose.', '股价上涨后，公司的市值增加。']],
  },
  {
    expression: 'earnings per share', sense: 'profit-attributable-per-share', zh: '每股收益', definition: 'profit attributable to ordinary shareholders divided by the weighted average ordinary shares outstanding', partOfSpeech: 'noun phrase', variants: ['EPS'], collocations: ['basic earnings per share', 'diluted earnings per share', 'calculate earnings per share'],
    examples: [['Earnings per share helps investors compare profit on a per-share basis.', '每股收益帮助投资者按每股基础比较利润。'], ['The annual report presents basic and diluted earnings per share.', '年度报告列报基本和稀释每股收益。']],
  },
  {
    expression: 'price-to-earnings ratio', sense: 'share-price-relative-to-earnings', zh: '市盈率', definition: 'a valuation ratio comparing a company\'s share price with its earnings per share', partOfSpeech: 'noun phrase', variants: ['price-earnings ratio', 'P/E ratio', 'PE ratio'], collocations: ['calculate the price-to-earnings ratio', 'high price-to-earnings ratio', 'forward price-to-earnings ratio'],
    examples: [['The price-to-earnings ratio compares market price with earnings per share.', '市盈率比较市场价格与每股收益。'], ['A high price-to-earnings ratio may reflect strong growth expectations.', '较高的市盈率可能反映强劲的增长预期。']],
  },
  {
    expression: 'budget', sense: 'organisational-financial-plan', zh: '企业预算', definition: 'a financial plan estimating income, costs, and cash needs for a future period', partOfSpeech: 'noun', collocations: ['prepare a budget', 'annual budget', 'budget approval'],
    examples: [['The budget sets expected sales and spending for the next year.', '企业预算设定下一年的预期销售额和支出。'], ['Department managers explained their budget requests to the finance team.', '部门经理向财务团队解释了预算申请。']],
  },
  {
    expression: 'forecast', sense: 'evidence-based-future-estimate', zh: '预测', definition: 'an estimate of a future financial result based on current information and assumptions', partOfSpeech: 'noun', collocations: ['sales forecast', 'cash flow forecast', 'update a forecast'],
    examples: [['The forecast is updated when actual sales differ from expectations.', '实际销售额与预期不同时会更新预测。'], ['A weekly cash forecast helps the startup plan supplier payments.', '每周现金预测帮助初创企业安排供应商付款。']],
  },
  {
    expression: 'variance', sense: 'actual-versus-planned-difference', zh: '差异', definition: 'the difference between an actual financial result and a budgeted or standard amount', partOfSpeech: 'noun', collocations: ['analyse a variance', 'favourable variance', 'budget variance'],
    examples: [['The variance arose because actual material costs exceeded the budget.', '该差异源于实际材料成本超过预算。'], ['Management investigated the large sales variance.', '管理层调查了较大的销售差异。']],
  },
  {
    expression: 'break-even point', sense: 'zero-profit-sales-level', zh: '盈亏平衡点', definition: 'the sales level at which total revenue equals total costs and profit is zero', partOfSpeech: 'noun phrase', variants: ['breakeven point'], collocations: ['calculate the break-even point', 'reach the break-even point', 'break-even point in units'],
    examples: [['The break-even point is reached when total revenue equals total cost.', '总收入等于总成本时达到盈亏平衡点。'], ['The café lowered its break-even point by reducing fixed rent.', '这家咖啡馆通过降低固定租金降低了盈亏平衡点。']],
  },
  {
    expression: 'fixed cost', sense: 'cost-unchanged-in-relevant-range', zh: '固定成本', definition: 'a cost that does not change in total with activity within a relevant range', partOfSpeech: 'noun phrase', collocations: ['monthly fixed cost', 'reduce fixed costs', 'fixed cost per unit'],
    examples: [['Office rent is usually a fixed cost within the lease period.', '办公室租金在租期内通常是固定成本。'], ['A higher sales volume spreads each fixed cost over more units.', '较高销量把每项固定成本分摊到更多单位上。']],
  },
  {
    expression: 'variable cost', sense: 'cost-changing-with-activity', zh: '变动成本', definition: 'a cost that changes in total in proportion to activity or output', partOfSpeech: 'noun phrase', collocations: ['variable cost per unit', 'total variable cost', 'reduce variable costs'],
    examples: [['Packaging is a variable cost that rises with the number of orders.', '包装是随订单数量增加而上升的变动成本。'], ['The business estimates variable cost per unit before setting its price.', '企业在定价前估算单位变动成本。']],
  },
  {
    expression: 'contribution margin', sense: 'sales-less-variable-costs', zh: '边际贡献', definition: 'sales revenue minus variable costs, available to cover fixed costs and profit', partOfSpeech: 'noun phrase', collocations: ['calculate contribution margin', 'contribution margin ratio', 'unit contribution margin'],
    examples: [['Contribution margin shows how much sales contribute to fixed costs and profit.', '边际贡献显示销售额对固定成本和利润的贡献。'], ['The manager calculated contribution margin for each product.', '经理计算了每种产品的边际贡献。']],
  },
  {
    expression: 'overhead', sense: 'indirect-operating-cost', zh: '间接费用', definition: 'an indirect cost of operating a business that cannot be traced easily to one product or service', partOfSpeech: 'noun', variants: ['overheads'], collocations: ['allocate overhead', 'manufacturing overhead', 'overhead cost'],
    examples: [['Factory rent is allocated as manufacturing overhead.', '工厂租金作为制造间接费用进行分配。'], ['The startup keeps overhead low by sharing office space.', '初创企业通过共享办公空间保持较低的间接费用。']],
  },
  {
    expression: 'audit', sense: 'independent-financial-examination', zh: '审计', definition: 'an independent examination of financial information to support an audit opinion', partOfSpeech: 'noun', collocations: ['conduct an audit', 'external audit', 'audit opinion'],
    examples: [['The audit provides reasonable, not absolute, assurance.', '审计提供合理保证，而非绝对保证。'], ['The year-end audit begins after management closes the accounts.', '管理层结账后，年终审计开始。']],
  },
  {
    expression: 'auditor', sense: 'independent-financial-examiner', zh: '审计师', definition: 'a qualified person who examines financial information and expresses an audit opinion', partOfSpeech: 'noun', collocations: ['external auditor', 'independent auditor', 'auditor judgement'],
    examples: [['The auditor evaluates whether the financial statements are materially misstated.', '审计师评估财务报表是否存在重大错报。'], ['The auditor asked management for supporting documents.', '审计师向管理层索取支持性文件。']],
  },
  {
    expression: 'audit evidence', sense: 'information-supporting-audit-conclusion', zh: '审计证据', definition: 'information used by an auditor to reach conclusions and support an audit opinion', partOfSpeech: 'noun phrase', collocations: ['obtain audit evidence', 'sufficient audit evidence', 'appropriate audit evidence'],
    examples: [['Audit evidence must be sufficient and appropriate for the assessed risk.', '审计证据必须针对所评估风险具备充分性和适当性。'], ['A bank confirmation can provide reliable audit evidence about cash.', '银行询证函可为现金提供可靠的审计证据。']],
  },
  {
    expression: 'internal control', sense: 'process-for-objectives-and-risk', zh: '内部控制', definition: 'a process designed to support reliable reporting, effective operations, and compliance', partOfSpeech: 'noun phrase', variants: ['internal controls'], collocations: ['design an internal control', 'test internal control', 'internal control weakness'],
    examples: [['An internal control requires a manager to approve large payments.', '一项内部控制要求经理批准大额付款。'], ['Separating cash handling from record-keeping strengthens internal control.', '把现金经手与记账职责分开可加强内部控制。']],
  },
  {
    expression: 'reconciliation', sense: 'comparison-and-resolution-of-records', zh: '对账', definition: 'the process of comparing two sets of records and explaining or correcting differences', partOfSpeech: 'noun', collocations: ['bank reconciliation', 'perform a reconciliation', 'monthly reconciliation'],
    examples: [['A bank reconciliation compares the cash ledger with the bank statement.', '银行对账把现金账簿与银行对账单进行比较。'], ['The monthly reconciliation found an unrecorded bank fee.', '月度对账发现了一笔未记录的银行手续费。']],
  },
  {
    expression: 'tax liability', sense: 'amount-of-tax-owed', zh: '应纳税额', definition: 'the amount of tax that an individual or entity is obliged to pay', partOfSpeech: 'noun phrase', zhAnswers: ['应付税款', '应交税费'], collocations: ['calculate tax liability', 'current tax liability', 'settle a tax liability'],
    examples: [['The current tax liability reflects tax payable on this year\'s taxable profit.', '当期应纳税额反映本年应税利润应付的税款。'], ['The company set aside cash to settle its tax liability.', '公司预留现金以清偿应纳税额。']],
  },
  {
    expression: 'deferred tax', sense: 'future-tax-from-temporary-differences', zh: '递延所得税', definition: 'tax recognised for future consequences of temporary differences and certain carryforwards', partOfSpeech: 'noun phrase', collocations: ['deferred tax asset', 'deferred tax liability', 'recognise deferred tax'],
    examples: [["Deferred tax can arise when an asset's carrying amount and tax base differ.", '资产的账面金额与计税基础不同时可能产生递延所得税。'], ['The entity recognised a deferred tax asset for eligible tax losses.', '主体对符合条件的税务亏损确认了递延所得税资产。']],
  },
  {
    expression: 'exchange rate', sense: 'currency-conversion-price', zh: '汇率', definition: 'the rate at which one currency can be exchanged for another', partOfSpeech: 'noun phrase', collocations: ['foreign exchange rate', 'exchange rate movement', 'closing exchange rate'],
    examples: [['The exchange rate determines how many ringgit are needed to buy one dollar.', '汇率决定购买一美元需要多少林吉特。'], ['An exchange rate movement changed the value of the foreign receivable.', '汇率变动改变了外币应收款的价值。']],
  },
  {
    expression: 'inflation', sense: 'general-price-level-rise', zh: '通货膨胀', definition: 'a sustained increase in the general level of prices that reduces purchasing power', partOfSpeech: 'noun', collocations: ['inflation rate', 'high inflation', 'adjust for inflation'],
    examples: [['Inflation reduces what a fixed amount of money can buy.', '通货膨胀降低固定金额货币的购买力。'], ['The analyst adjusted the forecast for expected inflation.', '分析师根据预期通货膨胀调整了预测。']],
  },
  {
    expression: 'IFRS', sense: 'international-reporting-standards', zh: '国际财务报告准则', definition: 'the standards and interpretations issued by the International Accounting Standards Board', partOfSpeech: 'proper noun', variants: ['International Financial Reporting Standards'], collocations: ['apply IFRS', 'IFRS Accounting Standards', 'comply with IFRS'],
    examples: [['IFRS aims to improve transparency and comparability in financial reporting.', '国际财务报告准则旨在提高财务报告的透明度和可比性。'], ['The accounting policy explains how the company applies IFRS.', '会计政策解释公司如何应用国际财务报告准则。']],
  },
  {
    expression: 'recognition', sense: 'including-item-in-statements', zh: '确认', definition: 'including an item in the financial statements when it meets the definition of a financial statement element and provides useful information (relevant and faithfully represented)', partOfSpeech: 'noun', collocations: ['revenue recognition', 'recognition criteria', 'initial recognition'],
    examples: [['Recognition places an asset, liability, income, or expense in the financial statements.', '确认把资产、负债、收入或费用纳入财务报表。'], ['The contract terms affect the timing of revenue recognition.', '合同条款影响收入确认的时间。']],
  },
  {
    expression: 'measurement', sense: 'determining-monetary-amount', zh: '计量', definition: 'the process of determining the monetary amount at which an item is recognised and reported', partOfSpeech: 'noun', collocations: ['initial measurement', 'subsequent measurement', 'measurement basis'],
    examples: [['Measurement requires selecting an appropriate basis such as historical cost or fair value.', '计量要求选择历史成本或公允价值等适当基础。'], ['The standard specifies the subsequent measurement of the asset.', '该准则规定了该资产的后续计量。']],
  },
  {
    expression: 'disclosure', sense: 'information-in-statements-or-notes', zh: '披露', definition: 'information presented in financial statements or notes to help users understand reported items and risks', partOfSpeech: 'noun', collocations: ['financial statement disclosure', 'risk disclosure', 'disclosure requirement'],
    examples: [['The disclosure explains the assumptions used in the impairment test.', '该披露解释了减值测试中使用的假设。'], ['A material uncertainty requires clear disclosure in the notes.', '重大不确定性需要在附注中清晰披露。']],
  },
]

const businessRows: SeedRow[] = [
  {
    expression: 'business model', sense: 'how-business-creates-and-captures-value', zh: '商业模式', definition: 'the system by which a business creates value for customers and earns money from doing so', partOfSpeech: 'noun phrase', collocations: ['develop a business model', 'sustainable business model', 'business model canvas'],
    examples: [['Our business model combines a free basic service with paid premium features.', '我们的商业模式把免费基础服务与付费高级功能结合起来。'], ['The founders tested whether the business model could generate recurring revenue.', '创始人测试了该商业模式能否产生经常性收入。']],
  },
  {
    expression: 'value proposition', sense: 'customer-benefit-promise', zh: '价值主张', definition: 'a clear statement of the benefit a product offers and why customers should choose it', partOfSpeech: 'noun phrase', collocations: ['define a value proposition', 'clear value proposition', 'test a value proposition'],
    examples: [['Our value proposition is faster bookkeeping for small Malaysian retailers.', '我们的价值主张是为马来西亚小型零售商提供更快捷的记账服务。'], ['Customer interviews helped us sharpen the value proposition.', '客户访谈帮助我们完善了价值主张。']],
  },
  {
    expression: 'target market', sense: 'intended-customer-group', zh: '目标市场', definition: 'the particular group of customers a business intends to serve', partOfSpeech: 'noun phrase', collocations: ['identify a target market', 'enter a target market', 'target market size'],
    examples: [['Our target market is independent cafés near university campuses.', '我们的目标市场是大学校园附近的独立咖啡馆。'], ['The survey showed that the target market cared most about ease of use.', '调查显示，目标市场最重视易用性。']],
  },
  {
    expression: 'customer segment', sense: 'customers-with-shared-needs', zh: '客户细分群体', definition: 'a group of customers who share similar needs, behaviours, or characteristics', partOfSpeech: 'noun phrase', zhAnswers: ['客户细分'], collocations: ['define a customer segment', 'serve a customer segment', 'profitable customer segment'],
    examples: [['Each customer segment receives a different onboarding message.', '每个客户细分群体会收到不同的引导信息。'], ['Student founders became our fastest-growing customer segment.', '学生创业者成为我们增长最快的客户群体。']],
  },
  {
    expression: 'market research', sense: 'systematic-market-information', zh: '市场调研', definition: 'the systematic collection and analysis of information about customers, competitors, and a market', partOfSpeech: 'noun phrase', collocations: ['conduct market research', 'market research findings', 'primary market research'],
    examples: [['Market research revealed that users wanted simpler invoices.', '市场调研显示用户希望发票更简单。'], ['We conducted market research before choosing our first campus location.', '选择第一个校园地点前，我们进行了市场调研。']],
  },
  {
    expression: 'competitor', sense: 'rival-serving-same-market', zh: '竞争对手', definition: 'a business offering a similar solution or competing for the same customers', partOfSpeech: 'noun', collocations: ['direct competitor', 'analyse a competitor', 'competitor pricing'],
    examples: [['A competitor launched a cheaper plan last month.', '一家竞争企业上个月推出了更便宜的方案。'], ['We compared each competitor on price, service, and speed.', '我们从价格、服务和速度方面比较了每个竞争对手。']],
  },
  {
    expression: 'competitive advantage', sense: 'hard-to-match-business-edge', zh: '竞争优势', definition: 'an attribute or capability that enables a business to outperform rivals; it is sustainable when difficult to imitate', partOfSpeech: 'noun phrase', collocations: ['build a competitive advantage', 'sustainable competitive advantage', 'source of competitive advantage'],
    examples: [['Local accounting expertise gives us a competitive advantage.', '本地会计专业知识给了我们竞争优势。'], ['Fast customer support became a sustainable competitive advantage.', '快速客户支持成为一种可持续竞争优势。']],
  },
  {
    expression: 'minimum viable product', sense: 'smallest-testable-product', zh: '最小可行产品', definition: 'the simplest product that can test important assumptions with real users', partOfSpeech: 'noun phrase', variants: ['MVP'], collocations: ['build a minimum viable product', 'launch an MVP', 'test an MVP'],
    examples: [['The minimum viable product handled invoices but not payroll.', '最小可行产品能处理发票，但还不能处理工资。'], ['We built a minimum viable product in two weeks to test demand.', '我们用两周构建了最小可行产品来测试需求。']],
  },
  {
    expression: 'prototype', sense: 'early-test-version', zh: '原型', definition: 'an early version of a product used to explore, demonstrate, or test an idea', partOfSpeech: 'noun', collocations: ['build a prototype', 'test a prototype', 'working prototype'],
    examples: [['The prototype showed the payment flow without processing real money.', '这个原型展示了支付流程，但不会处理真实资金。'], ['Five students tested the prototype and described where they became confused.', '五名学生测试了原型，并说明了感到困惑的地方。']],
  },
  {
    expression: 'product-market fit', sense: 'strong-market-demand-match', zh: '产品市场匹配', definition: 'a state in which a product satisfies strong demand from a clearly defined market', partOfSpeech: 'noun phrase', variants: ['product market fit', 'PMF'], collocations: ['achieve product-market fit', 'search for product-market fit', 'evidence of product-market fit'],
    examples: [['High retention can provide evidence of product-market fit.', '较高的留存率可以为产品市场匹配提供证据。'], ['The team focused on one customer segment while searching for product-market fit.', '团队在寻找产品市场匹配时专注于一个客户群体。']],
  },
  {
    expression: 'user feedback', sense: 'users-comments-and-observations', zh: '用户反馈', definition: 'comments and observations from people who use or test a product', partOfSpeech: 'noun phrase', collocations: ['collect user feedback', 'act on user feedback', 'user feedback session'],
    examples: [['User feedback showed that the sign-up form was too long.', '用户反馈显示注册表单太长。'], ['We review user feedback before planning the next release.', '规划下一个版本前，我们会审查用户反馈。']],
  },
  {
    expression: 'pain point', sense: 'specific-customer-problem', zh: '客户痛点', definition: 'a specific problem or frustration experienced by a customer', partOfSpeech: 'noun phrase', collocations: ['identify a pain point', 'address a pain point', 'major pain point'],
    examples: [['Late supplier updates were a major pain point for café owners.', '供应商更新延迟是咖啡馆老板的一大痛点。'], ['The interview helped us understand the customer\'s real pain point.', '这次访谈帮助我们理解客户的真实痛点。']],
  },
  {
    expression: 'validate an idea', sense: 'test-idea-with-evidence', zh: '验证想法', definition: 'to test whether an idea is supported by evidence from customers or the market', partOfSpeech: 'verb phrase', collocations: ['validate an idea quickly', 'validate an idea with customers', 'experiment to validate an idea'],
    examples: [['We used ten customer interviews to validate an idea before writing code.', '我们在编写代码前通过十次客户访谈验证想法。'], ['A pre-order page can help validate an idea with real buying behaviour.', '预订页面可以通过真实购买行为帮助验证想法。']],
  },
  {
    expression: 'pivot', sense: 'strategic-change-based-on-learning', zh: '转变创业方向', definition: 'to make a significant change to a product or strategy based on evidence and learning', partOfSpeech: 'verb', collocations: ['decide to pivot', 'pivot to a new market', 'strategic pivot'],
    examples: [['The founders decided to pivot from consumers to small businesses.', '创始人决定从消费者市场转向小型企业市场。'], ['We did not pivot until the same problem appeared in several experiments.', '直到多个实验出现同样问题，我们才转变方向。']],
  },
  {
    expression: 'iterate', sense: 'improve-through-repeated-cycles', zh: '迭代改进', definition: 'to improve something through repeated cycles of building, testing, and learning', partOfSpeech: 'verb', collocations: ['iterate quickly', 'iterate on a product', 'test and iterate'],
    examples: [['We iterate on the onboarding flow after each user test.', '每次用户测试后，我们都会迭代改进新手引导流程。'], ['Small teams can often test and iterate quickly.', '小团队通常可以快速测试和迭代。']],
  },
  {
    expression: 'launch', sense: 'release-to-market', zh: '发布上市', definition: 'to make a product or service available to customers for the first time', partOfSpeech: 'verb', zhAnswers: ['推出'], collocations: ['launch a product', 'soft launch', 'launch date'],
    examples: [['We plan to launch the service at two campuses in September.', '我们计划九月在两个校园推出这项服务。'], ['A soft launch helped the team fix problems before wider promotion.', '小范围发布帮助团队在大规模推广前修复问题。']],
  },
  {
    expression: 'traction', sense: 'evidence-of-customer-momentum', zh: '市场进展', definition: 'evidence that a business is gaining customers, usage, revenue, or other meaningful momentum', partOfSpeech: 'noun', zhAnswers: ['增长势头'], collocations: ['gain traction', 'early traction', 'show traction'],
    examples: [['The startup gained traction after twenty cafés began paying monthly.', '二十家咖啡馆开始按月付费后，这家初创企业获得了市场进展。'], ['Investors asked for evidence of traction, not just download numbers.', '投资者要求提供真实增长势头的证据，而不只是下载量。']],
  },
  {
    expression: 'key metric', sense: 'important-performance-measure', zh: '关键指标', definition: 'a quantitative measure that closely reflects progress towards an important business goal', partOfSpeech: 'noun phrase', collocations: ['track a key metric', 'choose a key metric', 'weekly key metric'],
    examples: [['Our key metric is the number of shops that send an invoice each week.', '我们的关键指标是每周发送发票的商店数量。'], ['The team chose a key metric connected to customer value.', '团队选择了一个与客户价值相关的关键指标。']],
  },
  {
    expression: 'conversion rate', sense: 'desired-action-percentage', zh: '转化率', definition: 'the percentage of people who complete a desired action out of those who had the opportunity', partOfSpeech: 'noun phrase', collocations: ['increase conversion rate', 'checkout conversion rate', 'calculate conversion rate'],
    examples: [['The conversion rate rose after we simplified the registration page.', '简化注册页面后，转化率上升了。'], ['We calculate conversion rate by dividing purchases by qualified visits.', '我们用购买次数除以合格访问次数来计算转化率。']],
  },
  {
    expression: 'retention rate', sense: 'customers-still-active-percentage', zh: '留存率', definition: 'the percentage of customers or users who remain active over a defined period', partOfSpeech: 'noun phrase', collocations: ['improve retention rate', 'monthly retention rate', 'customer retention rate'],
    examples: [['The monthly retention rate shows how many customers remain active.', '月留存率显示还有多少客户保持活跃。'], ['Better onboarding improved the retention rate for new users.', '更好的新手引导提高了新用户的留存率。']],
  },
  {
    expression: 'churn rate', sense: 'customer-loss-percentage', zh: '客户流失率', definition: 'the percentage of customers who stop using or paying for a service during a period', partOfSpeech: 'noun phrase', collocations: ['reduce churn rate', 'monthly churn rate', 'customer churn rate'],
    examples: [['The churn rate fell after we introduced faster support.', '推出更快的支持服务后，客户流失率下降了。'], ['A high churn rate can hide growth in new subscriptions.', '较高的流失率可能掩盖新订阅的增长。']],
  },
  {
    expression: 'customer acquisition cost', sense: 'cost-per-new-customer', zh: '获客成本', definition: 'the average sales and marketing cost required to gain one new customer', partOfSpeech: 'noun phrase', variants: ['CAC'], collocations: ['calculate customer acquisition cost', 'reduce customer acquisition cost', 'customer acquisition cost payback'],
    examples: [['Customer acquisition cost fell when referrals generated more sign-ups.', '推荐带来更多注册后，获客成本下降了。'], ['We compare customer acquisition cost with lifetime value before scaling ads.', '扩大广告投放前，我们会比较获客成本与客户终身价值。']],
  },
  {
    expression: 'lifetime value', sense: 'expected-customer-lifetime-contribution', zh: '客户终身价值', definition: 'the expected economic value a customer contributes over the full relationship with a business', partOfSpeech: 'noun phrase', variants: ['customer lifetime value', 'LTV', 'CLV'], collocations: ['estimate lifetime value', 'increase lifetime value', 'lifetime value to CAC ratio'],
    examples: [['Lifetime value increases when customers stay longer and buy more.', '客户留存更久且购买更多时，客户终身价值会上升。'], ['The founder used a cautious lifetime value estimate in the forecast.', '创始人在预测中使用了谨慎的客户终身价值估计。']],
  },
  {
    expression: 'revenue stream', sense: 'distinct-source-of-income', zh: '收入来源', definition: 'a distinct way in which a business earns money from customers', partOfSpeech: 'noun phrase', collocations: ['create a revenue stream', 'recurring revenue stream', 'diversify revenue streams'],
    examples: [['Monthly subscriptions are our main revenue stream.', '月度订阅是我们的主要收入来源。'], ['Training services created a second revenue stream for the company.', '培训服务为公司创造了第二个收入来源。']],
  },
  {
    expression: 'pricing strategy', sense: 'planned-approach-to-prices', zh: '定价策略', definition: 'a planned approach to setting prices based on value, costs, customers, and competition', partOfSpeech: 'noun phrase', collocations: ['develop a pricing strategy', 'value-based pricing strategy', 'review a pricing strategy'],
    examples: [['Our pricing strategy offers a low entry plan for student founders.', '我们的定价策略为学生创业者提供低门槛方案。'], ['The team reviewed its pricing strategy after interviewing paying customers.', '团队在访谈付费客户后审查了定价策略。']],
  },
  {
    expression: 'subscription', sense: 'recurring-access-payment', zh: '订阅', definition: 'an arrangement in which a customer pays regularly for continued access to a product or service', partOfSpeech: 'noun', collocations: ['monthly subscription', 'cancel a subscription', 'subscription plan'],
    examples: [['The monthly subscription includes support and automatic updates.', '月度订阅包含支持服务和自动更新。'], ['Customers can cancel the subscription without a long-term contract.', '客户无需长期合同即可取消订阅。']],
  },
  {
    expression: 'cash runway', sense: 'time-before-cash-runs-out', zh: '现金可维持期', definition: 'the length of time a business can operate before its available cash is exhausted', partOfSpeech: 'noun phrase', variants: ['runway'], collocations: ['extend cash runway', 'twelve-month cash runway', 'calculate cash runway'],
    examples: [['Our cash runway is nine months at the current spending rate.', '按当前支出速度，我们的现金可维持期是九个月。'], ['Reducing office costs extended the cash runway.', '降低办公成本延长了现金可维持期。']],
  },
  {
    expression: 'burn rate', sense: 'rate-of-cash-spending', zh: '现金消耗率', definition: 'the rate at which a startup spends its available cash, usually measured monthly', partOfSpeech: 'noun phrase', collocations: ['monthly burn rate', 'reduce burn rate', 'net burn rate'],
    examples: [['The monthly burn rate includes salaries, rent, and software costs.', '月度现金消耗率包括工资、租金和软件成本。'], ['Management reduced the burn rate when fundraising took longer than expected.', '融资时间比预期更长时，管理层降低了现金消耗率。']],
  },
  {
    expression: 'seed funding', sense: 'early-stage-business-finance', zh: '种子轮融资', definition: 'early-stage financing used to develop and test a new business', partOfSpeech: 'noun phrase', collocations: ['raise seed funding', 'seed funding round', 'secure seed funding'],
    examples: [['The startup used seed funding to hire two engineers and test sales.', '这家初创企业用种子轮融资聘请两名工程师并测试销售。'], ['Before raising seed funding, the founders agreed on milestones.', '在筹集种子轮融资前，创始人就里程碑达成一致。']],
  },
  {
    expression: 'angel investor', sense: 'individual-early-stage-investor', zh: '天使投资人', definition: 'an individual who invests personal money in an early-stage business', partOfSpeech: 'noun phrase', collocations: ['approach an angel investor', 'experienced angel investor', 'angel investor network'],
    examples: [['An angel investor offered capital and retail industry advice.', '一位天使投资人提供了资金和零售行业建议。'], ['The founders met the angel investor through a university network.', '创始人通过大学人脉认识了这位天使投资人。']],
  },
  {
    expression: 'venture capital', sense: 'professional-high-growth-equity-finance', zh: '风险投资', definition: 'equity financing from professional investors for businesses with high growth potential', partOfSpeech: 'noun phrase', variants: ['VC'], collocations: ['raise venture capital', 'venture capital firm', 'venture capital funding'],
    examples: [['Venture capital can support rapid growth but usually dilutes founders\' ownership.', '风险投资可以支持快速增长，但通常会稀释创始人的所有权。'], ['The company approached a venture capital firm after reaching regional traction.', '公司在获得区域市场进展后接洽了一家风险投资机构。']],
  },
  {
    expression: 'pitch deck', sense: 'investor-presentation-slides', zh: '融资演示文稿', definition: 'a short slide presentation that explains a business opportunity to potential investors', partOfSpeech: 'noun phrase', collocations: ['prepare a pitch deck', 'investor pitch deck', 'pitch deck slide'],
    examples: [['The pitch deck explains the problem, solution, traction, and funding request.', '融资演示文稿解释问题、解决方案、市场进展和融资需求。'], ['We revised the pitch deck after investors questioned our market size.', '投资者质疑市场规模后，我们修改了融资演示文稿。']],
  },
  {
    expression: 'elevator pitch', sense: 'brief-persuasive-business-summary', zh: '电梯式推介', definition: 'a brief and persuasive explanation of a business that can be delivered in under a minute', partOfSpeech: 'noun phrase', collocations: ['deliver an elevator pitch', 'practise an elevator pitch', 'thirty-second elevator pitch'],
    examples: [['My elevator pitch explains the customer problem in two sentences.', '我的电梯式推介用两句话解释客户问题。'], ['She practised the elevator pitch before the networking event.', '她在社交活动前练习了电梯式推介。']],
  },
  {
    expression: 'term sheet', sense: 'proposed-investment-terms-summary', zh: '投资条款清单', definition: 'a document summarising the main proposed terms of an investment before final agreements', partOfSpeech: 'noun phrase', collocations: ['sign a term sheet', 'negotiate a term sheet', 'term sheet terms'],
    examples: [['The term sheet stated the valuation, investment amount, and investor rights.', '投资条款清单列明估值、投资金额和投资者权利。'], ['The founders asked a lawyer to review the term sheet.', '创始人请律师审查投资条款清单。']],
  },
  {
    expression: 'due diligence', sense: 'pre-deal-investigation', zh: '尽职调查', definition: 'a detailed investigation of a business before an investment, acquisition, or major agreement', partOfSpeech: 'noun phrase', collocations: ['conduct due diligence', 'due diligence process', 'financial due diligence'],
    examples: [['Due diligence included checking contracts, accounts, and ownership records.', '尽职调查包括核查合同、账目和所有权记录。'], ['Organised files made the due diligence process faster.', '整理有序的文件加快了尽职调查流程。']],
  },
  {
    expression: 'cap table', sense: 'company-ownership-record', zh: '股权结构表', definition: 'a record showing a company\'s shareholders, securities, and ownership percentages', partOfSpeech: 'noun phrase', variants: ['capitalisation table', 'capitalization table'], collocations: ['update the cap table', 'fully diluted cap table', 'cap table ownership'],
    examples: [['The cap table shows how much of the company each founder owns.', '股权结构表显示每位创始人拥有公司多少权益。'], ['Issuing new shares requires an update to the cap table.', '发行新股需要更新股权结构表。']],
  },
  {
    expression: 'co-founder', sense: 'joint-business-founder', zh: '联合创始人', definition: 'a person who starts a business together with one or more other people', partOfSpeech: 'noun', variants: ['cofounder'], collocations: ['find a co-founder', 'technical co-founder', 'co-founder agreement'],
    examples: [['My co-founder leads product development while I handle finance.', '我的联合创始人负责产品开发，而我负责财务。'], ['A written agreement clarified each co-founder\'s responsibilities.', '书面协议明确了每位联合创始人的职责。']],
  },
  {
    expression: 'stakeholder', sense: 'party-affected-or-interested', zh: '利益相关者', definition: 'a person or organisation that can affect or is affected by a business or project', partOfSpeech: 'noun', collocations: ['key stakeholder', 'stakeholder meeting', 'manage stakeholder expectations'],
    examples: [['Each stakeholder received an update before the service changed.', '服务变更前，每位利益相关者都收到了更新。'], ['Customers, employees, and investors are important stakeholders.', '客户、员工和投资者都是重要的利益相关者。']],
  },
  {
    expression: 'partnership', sense: 'cooperative-business-relationship', zh: '合作关系', definition: 'a cooperative relationship in which parties work together towards shared business goals', partOfSpeech: 'noun', collocations: ['form a partnership', 'strategic partnership', 'partnership agreement'],
    examples: [['The partnership gives us access to three university campuses.', '这项合作关系让我们可以进入三个大学校园。'], ['Both companies defined clear goals before forming the partnership.', '两家公司在建立合作关系前明确了目标。']],
  },
  {
    expression: 'supplier', sense: 'business-providing-inputs', zh: '供应商', definition: 'a business or person that provides goods or services to another organisation', partOfSpeech: 'noun', collocations: ['choose a supplier', 'reliable supplier', 'supplier payment'],
    examples: [['Our main supplier delivers packaging every Tuesday.', '我们的主要供应商每周二配送包装材料。'], ['We evaluated each supplier on price, quality, and reliability.', '我们从价格、质量和可靠性方面评估了每家供应商。']],
  },
  {
    expression: 'negotiate', sense: 'discuss-to-reach-agreement', zh: '谈判协商', definition: 'to discuss terms with another party in order to reach an agreement', partOfSpeech: 'verb', collocations: ['negotiate a contract', 'negotiate with a supplier', 'negotiate better terms'],
    examples: [['We negotiate payment terms before placing a large order.', '下大额订单前，我们会协商付款条件。'], ['The founder negotiated with the landlord for a lower deposit.', '创始人与房东协商降低押金。']],
  },
  {
    expression: 'contract', sense: 'legally-binding-agreement', zh: '合同', definition: 'a legally binding agreement between two or more parties', partOfSpeech: 'noun', collocations: ['sign a contract', 'review a contract', 'contract terms'],
    examples: [['The contract states the price, delivery date, and payment terms.', '合同列明价格、交付日期和付款条件。'], ['Never sign a contract before understanding the termination clause.', '在理解终止条款前绝不要签合同。']],
  },
  {
    expression: 'invoice', sense: 'seller-payment-request-document', zh: '发票', definition: 'a document from a seller listing goods or services supplied and the amount due', partOfSpeech: 'noun', collocations: ['issue an invoice', 'pay an invoice', 'invoice number'],
    examples: [['The invoice is due within thirty days of the issue date.', '发票应在开具日期后三十天内支付。'], ['We checked the invoice against the delivered quantities.', '我们根据实际交付数量核对了发票。']],
  },
  {
    expression: 'purchase order', sense: 'buyer-order-authorisation-document', zh: '采购订单', definition: 'a formal document from a buyer authorising the purchase of specified goods or services', partOfSpeech: 'noun phrase', variants: ['PO'], collocations: ['issue a purchase order', 'approve a purchase order', 'purchase order number'],
    examples: [['The purchase order specifies two hundred boxes at the agreed price.', '采购订单注明按约定价格购买两百个盒子。'], ['The supplier requested a purchase order before beginning production.', '供应商要求在开始生产前提供采购订单。']],
  },
  {
    expression: 'fulfilment', sense: 'processing-and-delivering-orders', zh: '订单履约', definition: 'the process of receiving, preparing, and delivering customer orders', partOfSpeech: 'noun', variants: ['fulfillment'], collocations: ['order fulfilment', 'fulfilment centre', 'improve fulfilment'],
    examples: [['Fast fulfilment helped the shop earn repeat orders.', '快速订单履约帮助商店获得了重复订单。'], ['We outsourced fulfilment when daily order volume doubled.', '日订单量翻倍后，我们把订单履约外包了。']],
  },
  {
    expression: 'inventory management', sense: 'planning-and-controlling-stock', zh: '库存管理', definition: 'the process of ordering, storing, tracking, and controlling stock', partOfSpeech: 'noun phrase', collocations: ['improve inventory management', 'inventory management system', 'effective inventory management'],
    examples: [['Inventory management prevents both stockouts and excess stock.', '库存管理可以防止缺货和库存过剩。'], ['The café adopted an inventory management system for ingredients.', '这家咖啡馆采用了食材库存管理系统。']],
  },
  {
    expression: 'lead', sense: 'potential-customer-contact', zh: '销售线索', definition: 'a person or organisation that may have an interest in buying a product or service', partOfSpeech: 'noun', collocations: ['generate a lead', 'qualified lead', 'sales lead'],
    examples: [['A webinar generated a lead from a regional retailer.', '一场网络研讨会带来了一条区域零售商销售线索。'], ['The sales team checks whether each lead matches the target market.', '销售团队检查每条线索是否符合目标市场。']],
  },
  {
    expression: 'prospect', sense: 'qualified-potential-buyer', zh: '潜在客户', definition: 'a potential customer who has been assessed as having a realistic chance of buying', partOfSpeech: 'noun', collocations: ['contact a prospect', 'qualified prospect', 'sales prospect'],
    examples: [['The prospect requested a demonstration before discussing price.', '这位潜在客户要求先看演示，再讨论价格。'], ['We prioritise each prospect according to need, budget, and timing.', '我们根据需求、预算和时间安排确定每位潜在客户的优先级。']],
  },
  {
    expression: 'sales pipeline', sense: 'stages-of-active-sales-opportunities', zh: '销售管道', definition: 'the set of active sales opportunities organised by their stage in the buying process', partOfSpeech: 'noun phrase', collocations: ['manage a sales pipeline', 'sales pipeline stage', 'healthy sales pipeline'],
    examples: [['The sales pipeline shows which prospects need a proposal this week.', '销售管道显示本周哪些潜在客户需要方案。'], ['A weekly review keeps the sales pipeline accurate.', '每周复盘可保持销售管道准确。']],
  },
  {
    expression: 'close a deal', sense: 'complete-sales-agreement', zh: '达成交易', definition: 'to complete negotiations and reach a final sales agreement', partOfSpeech: 'verb phrase', collocations: ['close a deal quickly', 'close a major deal', 'help close a deal'],
    examples: [['We hope to close a deal after the customer approves the trial.', '客户批准试用后，我们希望达成交易。'], ['Clear payment terms helped the founder close a deal with the retailer.', '清晰的付款条件帮助创始人与零售商达成交易。']],
  },
  {
    expression: 'follow up', sense: 'contact-again-after-earlier-action', zh: '跟进', definition: 'to contact someone again or take further action after an earlier discussion or event', partOfSpeech: 'phrasal verb', collocations: ['follow up with a customer', 'follow up by email', 'follow up promptly'],
    examples: [['I will follow up with the prospect after tomorrow\'s demonstration.', '明天演示后，我会跟进这位潜在客户。'], ['The founder followed up by email with the promised price list.', '创始人通过邮件跟进，并附上承诺的价目表。']],
  },
  {
    expression: 'customer support', sense: 'help-for-product-customers', zh: '客户支持', definition: 'help provided to customers before, during, and after they use a product or service', partOfSpeech: 'noun phrase', collocations: ['contact customer support', 'customer support team', 'responsive customer support'],
    examples: [['Customer support answered the payment question within ten minutes.', '客户支持在十分钟内回答了付款问题。'], ['The team tracks repeated issues reported to customer support.', '团队追踪客户支持收到的重复问题。']],
  },
  {
    expression: 'refund', sense: 'money-returned-to-customer', zh: '退款', definition: 'money returned to a customer because a purchase is cancelled or unsatisfactory', partOfSpeech: 'noun', collocations: ['issue a refund', 'request a refund', 'full refund'],
    examples: [['We issued a refund when the order could not be delivered.', '订单无法交付时，我们发出了退款。'], ['The policy explains when a customer may request a refund.', '政策说明客户何时可以申请退款。']],
  },
  {
    expression: 'brand awareness', sense: 'customer-recognition-of-brand', zh: '品牌知名度', definition: 'the extent to which potential customers recognise or remember a brand', partOfSpeech: 'noun phrase', collocations: ['build brand awareness', 'increase brand awareness', 'measure brand awareness'],
    examples: [['Campus events helped us build brand awareness among students.', '校园活动帮助我们在学生中建立品牌知名度。'], ['The survey measured brand awareness before and after the campaign.', '调查衡量了活动前后的品牌知名度。']],
  },
  {
    expression: 'marketing campaign', sense: 'coordinated-promotion-activities', zh: '营销活动', definition: 'a coordinated set of activities designed to promote a product, service, or message', partOfSpeech: 'noun phrase', collocations: ['launch a marketing campaign', 'digital marketing campaign', 'measure a marketing campaign'],
    examples: [['The marketing campaign offered cafés a free fourteen-day trial.', '营销活动向咖啡馆提供十四天免费试用。'], ['We set a clear conversion goal for the marketing campaign.', '我们为营销活动设定了明确的转化目标。']],
  },
  {
    expression: 'social media engagement', sense: 'audience-interaction-with-social-content', zh: '社交媒体互动', definition: 'audience actions such as comments, shares, saves, and replies on social media content', partOfSpeech: 'noun phrase', collocations: ['increase social media engagement', 'measure social media engagement', 'social media engagement rate'],
    examples: [['Social media engagement increased when we posted customer stories.', '发布客户故事后，社交媒体互动增加了。'], ['The team measured meaningful social media engagement rather than views alone.', '团队衡量有意义的社交媒体互动，而不只是浏览量。']],
  },
  {
    expression: 'outsource', sense: 'use-external-provider', zh: '外包', definition: 'to arrange for an external provider to perform work instead of doing it internally', partOfSpeech: 'verb', collocations: ['outsource fulfilment', 'outsource accounting', 'outsource to a specialist'],
    examples: [['We outsource payroll to a specialist accounting firm.', '我们把工资核算外包给一家专业会计事务所。'], ['The founder decided not to outsource customer interviews.', '创始人决定不外包客户访谈。']],
  },
  {
    expression: 'delegate', sense: 'assign-responsibility-to-another', zh: '授权分派', definition: 'to give responsibility for a task or decision to another person', partOfSpeech: 'verb', collocations: ['delegate a task', 'delegate responsibility', 'delegate effectively'],
    examples: [['I delegate routine invoice checks to the operations assistant.', '我把日常发票检查分派给运营助理。'], ['A founder must delegate clearly as the team grows.', '随着团队成长，创始人必须清晰地授权分派。']],
  },
  {
    expression: 'scale up', sense: 'increase-business-capacity', zh: '扩大规模', definition: 'to increase a business\'s capacity, sales, or operations while maintaining performance', partOfSpeech: 'phrasal verb', collocations: ['scale up operations', 'scale up production', 'ready to scale up'],
    examples: [['We will scale up operations only after the delivery process is reliable.', '只有配送流程可靠后，我们才会扩大运营规模。'], ['The company hired regional managers to scale up across Malaysia.', '公司聘请区域经理，以便在马来西亚扩大规模。']],
  },
  {
    expression: 'contingency plan', sense: 'backup-plan-for-disruption', zh: '应急预案', definition: 'a prepared alternative plan for responding to a possible disruption or unexpected event', partOfSpeech: 'noun phrase', collocations: ['prepare a contingency plan', 'activate a contingency plan', 'business contingency plan'],
    examples: [['Our contingency plan names a second supplier if deliveries stop.', '我们的应急预案指定了在交付中断时启用的第二供应商。'], ['The team activated the contingency plan when the payment system failed.', '支付系统故障时，团队启动了应急预案。']],
  },
]

const dailyWords = buildCategory('daily', dailyRows)
const financeWords = buildCategory('finance', financeRows)
const businessWords = buildCategory('business', businessRows)

/** Handcrafted core seed (historical ids preserved for existing FSRS tracks). */
export const handcraftedSeedWords: Word[] = [
  ...dailyWords,
  ...financeWords,
  ...businessWords,
]

export const handcraftedSeedMemberships: WordListItem[] = [
  ...buildMemberships('daily', dailyWords),
  ...buildMemberships('finance', financeWords),
  ...buildMemberships('business', businessWords),
]

interface BundledSeed {
  words: Word[]
  memberships: WordListItem[]
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error('加载词库数据失败（' + response.status + '）。')
  }
  return response.json() as Promise<T>
}

let bundledSeedPromise: Promise<BundledSeed> | undefined

/**
 * Pack-derived seed generated by `node scripts/buildBundledSeedPack.mjs`,
 * served from public/data so the ~12 MB pack stays out of the app bundle.
 * Only callers that actually seed or refresh the library need to load it.
 * The revision query param keeps updated seed content from being served
 * by a stale HTTP cache under the same un-hashed URL.
 */
export function loadBundledSeed(): Promise<BundledSeed> {
  bundledSeedPromise ??= (async () => {
    try {
      const [words, memberships] = await Promise.all([
        fetchJson<Word[]>(`/data/bundledSeedWords.json?v=${SEED_CONTENT_REVISION}`),
        fetchJson<WordListItem[]>(`/data/bundledSeedMemberships.json?v=${SEED_CONTENT_REVISION}`),
      ])
      return { words, memberships }
    } catch (error) {
      // Allow a retry on the next call instead of caching the rejection.
      bundledSeedPromise = undefined
      throw error
    }
  })()
  return bundledSeedPromise
}

/** Full seed (handcrafted + bundled), for seeding a fresh or refreshed library. */
export async function loadSeedPack(): Promise<BundledSeed> {
  const bundled = await loadBundledSeed()
  return {
    words: [...handcraftedSeedWords, ...bundled.words],
    memberships: [...handcraftedSeedMemberships, ...bundled.memberships],
  }
}

export function selectAccountSeed(seed: BundledSeed, includeOriginal: boolean, expansionCategories: readonly SystemListSlug[] = []): BundledSeed {
  const listIds = new Set(expansionCategories.map(listIdForSlug))
  const memberships = seed.memberships.filter(membership => membership.wordId.startsWith('v6-')
    ? listIds.has(membership.listId)
    : includeOriginal)
  const expandedIds = new Set(memberships.map(membership => membership.wordId))
  return {
    words: seed.words.filter(word => word.id.startsWith('v6-') ? expandedIds.has(word.id) : includeOriginal),
    memberships,
  }
}
