// هيرو ماركت - تقرير نواقص المخزون
// ملف تنسيق Typst لإنتاج تقرير PDF راقٍ ومميز

#set page(
  paper: "a4",
  margin: (x: 1.5cm, top: 2.5cm, bottom: 2.5cm),
  header: context {
    if counter(page).get().first() > 1 {
      grid(
        columns: (1fr, 1fr),
        align(right)[#text(8pt, fill: rgb("#57606a"), font: "Cairo")[هيرو ماركت - تقرير النواقص]],
        align(left)[#text(8pt, fill: rgb("#57606a"), font: "Cairo")[تاريخ التقرير: #datetime.today().display("[day]/[month]/[year]")]]
      )
      line(length: 100%, stroke: 0.5pt + rgb("#e1e4e8"))
    }
  },
  footer: context {
    set align(center)
    set text(8pt, fill: rgb("#8c959f"), font: "Cairo")
    grid(
      columns: (1fr, 1fr),
      align(right)[هيرو ماركت © #datetime.today().display("[year]")],
      align(left)[صفحة #counter(page).display()]
    )
  }
)

#set text(
  font: ("Cairo", "Amiri", "Segoe UI", "Arial"),
  size: 11pt,
  lang: "ar",
  dir: rtl,
)

// تصميم الهيدر الرئيسي للمستند
#align(center)[
  #block(
    fill: rgb("#f4f9f9"),
    inset: 20pt,
    radius: 12pt,
    width: 100%,
    stroke: 1.5pt + rgb("#5b9a8b"),
    [
      #grid(
        columns: (1fr, auto),
        gutter: 20pt,
        align(right + horizon)[
          #text(22pt, weight: "bold", fill: rgb("#254b41"))[هيرو ماركت] \
          #v(4pt)
          #text(12pt, weight: "medium", fill: rgb("#5b9a8b"))[نظام إدارة الجرد والمستودعات الذكي]
        ],
        align(left + horizon)[
          #block(
            stroke: 1.5pt + rgb("#5b9a8b"),
            inset: 8pt,
            radius: 8pt,
            fill: white,
            [
              #text(10pt, weight: "bold", fill: rgb("#254b41"))[تقرير النواقص] \
              #text(9pt, fill: rgb("#57606a"))[#datetime.today().display("[day] / [month] / [year]")]
            ]
          )
        ]
      )
    ]
  )
]

#v(10pt)

// بطاقة التنبيه بتصميم جذاب
#block(
  fill: rgb("#fff5f5"),
  stroke: (right: 4pt + rgb("#e54b4b"), rest: 1pt + rgb("#fcd3d3")),
  inset: (x: 15pt, y: 12pt),
  radius: (left: 6pt, right: 0pt),
  width: 100%,
  [
    #grid(
      columns: (auto, 1fr),
      gutter: 10pt,
      align(horizon)[
        #text(16pt)[⚠️]
      ],
      align(horizon)[
        #text(11pt, weight: "bold", fill: rgb("#9e2a2b"))[تنبيه النواقص الملحّة:] \
        #text(10pt, fill: rgb("#2f3e46"))[تم رصد عدد *(10) أصناف* تجاوزت حد الطلب الأدنى أو وصلت إليه. يرجى توجيه طلبية شراء لتفادي نفاد الكميات.]
      ]
    )
  ]
)

#v(15pt)

// جدول البيانات بتصميم حديث ومقروء
#set table(
  stroke: (x, y) => if y == 0 { none } else { 0.5pt + rgb("#e1e8ed") },
  fill: (x, y) => {
    if y == 0 {
      rgb("#254b41") // لون الهيدر الأساسي الداكن
    } else if calc.even(y) {
      rgb("#f7f9fa") // لون خلفية الصفوف الزوجية
    } else {
      white
    }
  },
  inset: (x: 10pt, y: 10pt),
)

// ضبط خصائص خلايا الهيدر
#show table.cell.where(y: 0): set text(weight: "bold", fill: white, size: 11pt)

#align(center)[
  #table(
    columns: (40pt, 1fr, 80pt, 80pt, 60pt),
    align: (center + horizon, right + horizon, center + horizon, center + horizon, center + horizon),
    
    [م], [اسم الصنف], [الكمية الحالية], [حد الطلب], [الوحدة],
    
    [1], [مياه نسلة صغيرة 600مل], [19], [20], [كرتونة],
    [2], [فلوتس 4 صابع], [4], [4], [باكو],
    [3], [كرتونة مياه نسلة .600م], [1], [3], [كرتونة],
    [4], [تودو براوني], [3], [3], [باكو],
    [5], [كيك دور زبده], [1], [2], [باكو],
    [6], [هوووز كينج], [2], [4], [باكو],
    [7], [جاجوار برايم فلفل حلو], [1], [4], [علبة],
    [8], [شستوس حار نار ليمون], [5], [5], [كيس],
    [9], [تاو تاو تربو], [3], [3], [باكو],
    [10], [ماربيلا 2قطعه], [6], [6], [باكو],
  )
]
