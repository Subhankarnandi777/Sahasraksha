// Curated high-resolution scenic photography of Indian station regions & landmarks
const DEFAULT_IMAGE = {
  url: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=600&q=80",
  landmark: "Indian Meteorological Observatory"
};

const CITY_IMAGES = {
  SHILLONG: {
    url: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=600&q=80",
    landmark: "Shillong Pine Hills & Waterfalls"
  },
  VARANASI: {
    url: "https://images.unsplash.com/photo-1571536802807-30451e3955d8?auto=format&fit=crop&w=600&q=80",
    landmark: "Ganga Ghats & Kashi Aarti"
  },
  SAFDARJUNG: {
    url: "https://images.unsplash.com/photo-1587474260584-136574528ed5?auto=format&fit=crop&w=600&q=80",
    landmark: "India Gate, New Delhi"
  },
  DEHRADUN: {
    url: "https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?auto=format&fit=crop&w=600&q=80",
    landmark: "Doon Valley & Himalayan Foothills"
  },
  JAIPUR: {
    url: "https://images.unsplash.com/photo-1599661046289-e31897846e41?auto=format&fit=crop&w=600&q=80",
    landmark: "Hawa Mahal, Pink City"
  },
  JODHPUR: {
    url: "https://images.unsplash.com/photo-1589182373726-e4f658ab50f0?auto=format&fit=crop&w=600&q=80",
    landmark: "Mehrangarh Fort & Blue City"
  },
  BIKANER: {
    url: "https://images.unsplash.com/photo-1582510003544-4d00b7f74220?auto=format&fit=crop&w=600&q=80",
    landmark: "Thar Desert, Bikaner"
  },
  GANGANAGAR: {
    url: "https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?auto=format&fit=crop&w=600&q=80",
    landmark: "Northern Plains Canal Network"
  },
  HISAR: {
    url: "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=600&q=80",
    landmark: "Haryana Agricultural Plains"
  },
  BAREILLY: {
    url: "https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&w=600&q=80",
    landmark: "Rohilkhand Northern Plains"
  },
  BAHRAICH: {
    url: "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=600&q=80",
    landmark: "Terai Wetlands, Bahraich"
  },
  LILABARI: {
    url: "https://images.unsplash.com/photo-1518495973542-4542c06a5843?auto=format&fit=crop&w=600&q=80",
    landmark: "Assam Lush Foothills"
  },
  DIBRUGARH: {
    url: "https://images.unsplash.com/photo-1544735716-392fe2489ffa?auto=format&fit=crop&w=600&q=80",
    landmark: "Upper Brahmaputra Tea Estates"
  },
  AJMER: {
    url: "https://images.unsplash.com/photo-1590050752117-238cb0fb12b1?auto=format&fit=crop&w=600&q=80",
    landmark: "Ana Sagar Lake & Aravalli"
  },
  GWALIOR: {
    url: "https://images.unsplash.com/photo-1600100397608-f010f444f434?auto=format&fit=crop&w=600&q=80",
    landmark: "Historic Gwalior Fort"
  },
  LUCKNOW: {
    url: "https://images.unsplash.com/photo-1582510003544-4d00b7f74220?auto=format&fit=crop&w=600&q=80",
    landmark: "Rumi Darwaza & Gomti"
  },
  GORAKHPUR: {
    url: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=600&q=80",
    landmark: "Eastern UP River Basin"
  },
  TEZPUR: {
    url: "https://images.unsplash.com/photo-1518495973542-4542c06a5843?auto=format&fit=crop&w=600&q=80",
    landmark: "Brahmaputra Valley, Tezpur"
  },
  BARMER: {
    url: "https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?auto=format&fit=crop&w=600&q=80",
    landmark: "Great Indian Thar Dunes"
  },
  JHANSI: {
    url: "https://images.unsplash.com/photo-1600100397608-f010f444f434?auto=format&fit=crop&w=600&q=80",
    landmark: "Bundelkhand Citadel"
  },
  PATNA: {
    url: "https://images.unsplash.com/photo-1561361513-2d000a50f0dc?auto=format&fit=crop&w=600&q=80",
    landmark: "Ganga Riverfront, Patna"
  },
  PURNEA: {
    url: "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=600&q=80",
    landmark: "Mithila Agriculture Plains"
  },
  DEESA: {
    url: "https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?auto=format&fit=crop&w=600&q=80",
    landmark: "Banas River Semi-Arid Basin"
  },
  GUNA: {
    url: "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=600&q=80",
    landmark: "Malwa Plateau Highlands"
  },
  SATNA: {
    url: "https://images.unsplash.com/photo-1518495973542-4542c06a5843?auto=format&fit=crop&w=600&q=80",
    landmark: "Vindhya Range Forest"
  },
  DALTONGANJ: {
    url: "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=600&q=80",
    landmark: "Palamu Tiger Reserve Forest"
  },
  GAYA: {
    url: "https://images.unsplash.com/photo-1544735716-392fe2489ffa?auto=format&fit=crop&w=600&q=80",
    landmark: "Bodh Gaya Bodhi Tree Sanctuary"
  },
  BHUJ: {
    url: "https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?auto=format&fit=crop&w=600&q=80",
    landmark: "White Rann of Kutch"
  },
  AHMEDABAD: {
    url: "https://images.unsplash.com/photo-1582510003544-4d00b7f74220?auto=format&fit=crop&w=600&q=80",
    landmark: "Sabarmati Riverfront Promenade"
  },
  BHOPAL: {
    url: "https://images.unsplash.com/photo-1590050752117-238cb0fb12b1?auto=format&fit=crop&w=600&q=80",
    landmark: "Bhojtal Upper Lake, City of Lakes"
  },
  SAGAR: {
    url: "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=600&q=80",
    landmark: "Lakha Banjara Lake"
  },
  JABALPUR: {
    url: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=600&q=80",
    landmark: "Bhedaghat Marble Rocks & Narmada"
  },
  BIRSA: {
    url: "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=600&q=80",
    landmark: "Chota Nagpur Plateau, Ranchi"
  },
  NETAJI: {
    url: "https://images.unsplash.com/photo-1558431382-27e303142255?auto=format&fit=crop&w=600&q=80",
    landmark: "Howrah Bridge & Hooghly, Kolkata"
  },
  KOLKATA: {
    url: "https://images.unsplash.com/photo-1558431382-27e303142255?auto=format&fit=crop&w=600&q=80",
    landmark: "Victoria Memorial & Howrah Bridge"
  },
  AMBEDKAR: {
    url: "https://images.unsplash.com/photo-1590050752117-238cb0fb12b1?auto=format&fit=crop&w=600&q=80",
    landmark: "Zero Mile Stone & Deekshabhoomi, Nagpur"
  },
  VIVEKANANDA: {
    url: "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=600&q=80",
    landmark: "Mahanadi Basin, Raipur"
  },
  BALASORE: {
    url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=80",
    landmark: "Chandipur Receding Sea Coast"
  },
  JAGDALPUR: {
    url: "https://images.unsplash.com/photo-1518495973542-4542c06a5843?auto=format&fit=crop&w=600&q=80",
    landmark: "Chitrakote Niagara of India"
  },
  GOPALPUR: {
    url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=80",
    landmark: "Gopalpur on Sea, Bay of Bengal"
  },
  PUNE: {
    url: "https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?auto=format&fit=crop&w=600&q=80",
    landmark: "Western Ghats Sahyadri, Pune"
  },
  NIZAMABAD: {
    url: "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=600&q=80",
    landmark: "Godavari Basin, Telangana"
  },
  KALINGAPATAM: {
    url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=80",
    landmark: "Coromandel Coastal Lighthouse"
  },
  RATNAGIRI: {
    url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=80",
    landmark: "Konkan Cliffs & Arabian Sea"
  },
  SOLAPUR: {
    url: "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=600&q=80",
    landmark: "Deccan Plateau Grasslands"
  },
  BEGUMPET: {
    url: "https://images.unsplash.com/photo-1572455044327-7348c1be7267?auto=format&fit=crop&w=600&q=80",
    landmark: "Charminar & Hussain Sagar, Hyderabad"
  },
  HYDERABAD: {
    url: "https://images.unsplash.com/photo-1572455044327-7348c1be7267?auto=format&fit=crop&w=600&q=80",
    landmark: "Charminar & Golconda Fort"
  },
  KAKINADA: {
    url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=80",
    landmark: "Coringa Mangroves & Deep Sea Port"
  },
  GADAG: {
    url: "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=600&q=80",
    landmark: "Kalyana Chalukya Heritage Plain"
  },
  KURNOOL: {
    url: "https://images.unsplash.com/photo-1518495973542-4542c06a5843?auto=format&fit=crop&w=600&q=80",
    landmark: "Tungabhadra River & Oravakallu"
  },
  HONAVAR: {
    url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=80",
    landmark: "Sharavati Estuary & Arabian Sea"
  },
  CHITRADURGA: {
    url: "https://images.unsplash.com/photo-1600100397608-f010f444f434?auto=format&fit=crop&w=600&q=80",
    landmark: "Stone Fortress of Chitradurga"
  },
  NELLORE: {
    url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=80",
    landmark: "Pulicat Lagoon & Penna River"
  },
  CHENNAI: {
    url: "https://images.unsplash.com/photo-1582510003544-4d00b7f74220?auto=format&fit=crop&w=600&q=80",
    landmark: "Marina Beach & San Thome, Chennai"
  },
  BANGALORE: {
    url: "https://images.unsplash.com/photo-1596176530529-78163a4f7af2?auto=format&fit=crop&w=600&q=80",
    landmark: "Vidhana Soudha & Garden City"
  },
  KOZHIKODE: {
    url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=80",
    landmark: "Kappad Historic Beach Coastline"
  },
  CUDDALORE: {
    url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=80",
    landmark: "Silver Beach & Coromandel Coast"
  },
  TIRUCHIRAPPALLI: {
    url: "https://images.unsplash.com/photo-1600100397608-f010f444f434?auto=format&fit=crop&w=600&q=80",
    landmark: "Rockfort Temple & Kaveri River"
  },
  NAGAPPATTINAM: {
    url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=80",
    landmark: "Poompuhar Ancient Bay Coast"
  },
  MADURAI: {
    url: "https://images.unsplash.com/photo-1582510003544-4d00b7f74220?auto=format&fit=crop&w=600&q=80",
    landmark: "Meenakshi Amman Gopuram Towers"
  },
  MINICOY: {
    url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=80",
    landmark: "Minicoy Atoll Lagoon & Lighthouse"
  },
  THIRUVANANTHAPURAM: {
    url: "https://images.unsplash.com/photo-1602216056096-3b40cc0c9944?auto=format&fit=crop&w=600&q=80",
    landmark: "Kovalam Coast & Kerala Palm Palms"
  }
};

export function getStationImage(stationName = "") {
  const upper = (stationName || "").toUpperCase();
  for (const [key, val] of Object.entries(CITY_IMAGES)) {
    if (upper.includes(key)) {
      return val;
    }
  }
  return DEFAULT_IMAGE;
}
