import { GoogleGenAI, Type } from "@google/genai";
import { ReceiptData } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Preprocesses an image file for better OCR accuracy.
 * 1. Resizes large images to max 1024px (speeds up AI processing).
 * 2. Converts to Grayscale (removes color noise, highlights text).
 */
export const preprocessImage = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error("Canvas context not supported"));
        return;
      }

      // 1. Resize Logic (Max dimension 1024px)
      const MAX_SIZE = 1024;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > MAX_SIZE) {
          height *= MAX_SIZE / width;
          width = MAX_SIZE;
        }
      } else {
        if (height > MAX_SIZE) {
          width *= MAX_SIZE / height;
          height = MAX_SIZE;
        }
      }

      canvas.width = width;
      canvas.height = height;

      // Draw image
      ctx.drawImage(img, 0, 0, width, height);

      // 2. Grayscale Filter Logic
      const imageData = ctx.getImageData(0, 0, width, height);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        // Standard luminosity formula
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        data[i] = gray;
        data[i + 1] = gray;
        data[i + 2] = gray;
      }
      ctx.putImageData(imageData, 0, 0);

      // Export as JPEG with 0.6 quality (Optimized for storage)
      resolve(canvas.toDataURL('image/jpeg', 0.6));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
};

export const analyzeReceipt = async (base64Image: string): Promise<ReceiptData> => {
  // Remove header if present
  const cleanBase64 = base64Image.replace(/^data:image\/(png|jpg|jpeg|webp);base64,/, "");

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: cleanBase64
            }
          },
          {
            text: `You are an expert OCR engine for Traditional Chinese receipts (Taiwan Uniform Invoices / 統一發票).
            Analyze the image and extract the following strictly:
            
            1. **Date**: 
               - Look for "YYYY-MM-DD" or "YYYY/MM/DD".
               - **CRITICAL**: If the year is in Republic of China format (e.g., 113年, 114年), add 1911 to convert to Gregorian (e.g., 113 = 2024, 114 = 2025).
               - If date is completely illegible, use today's date: ${new Date().toISOString().split('T')[0]}.
            
            2. **Amount**: 
               - Look for the "Total", "總計", "合計", "小計" line. 
               - Ignore "Tax" (稅額) or "Change" (找零).
               - Return numeric value only (remove $, NT$, comma).
            
            3. **Description**:
               - Identify the Merchant Name (usually at the top, e.g., 7-ELEVEN, 全家, PX Mart).
               - Or summarize the main item.
               - Language: Traditional Chinese.
            
            4. **Category**:
               - Classify based on the merchant or items into: [Food, Transport, Shopping, Bills, Healthcare, Education, Travel, Entertainment].
            
            Return raw JSON.`
          }
        ]
      },
      config: {
        // Zero temperature for deterministic OCR
        temperature: 0,
        topK: 1,
        topP: 0.95,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            date: { type: Type.STRING },
            amount: { type: Type.NUMBER },
            description: { type: Type.STRING },
            category: { type: Type.STRING }
          },
          required: ["date", "amount", "description", "category"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");
    
    const parsed = JSON.parse(text) as ReceiptData;

    // Robust Amount Parsing
    if (typeof parsed.amount !== 'number' || isNaN(parsed.amount)) {
        const cleaned = String(parsed.amount || '').replace(/[^0-9.]/g, '');
        parsed.amount = parseFloat(cleaned) || 0;
    }

    // Robust Date Parsing
    let finalDate = new Date().toISOString().split('T')[0];
    try {
        if (parsed.date) {
            let dateStr = String(parsed.date).replace(/[\/\.\年月日]/g, '-').replace(/日/g, '');
            // Simple check for ROC year offset if AI missed it (e.g., starts with 113 or 114)
            const parts = dateStr.split('-');
            if (parts.length === 3 && parseInt(parts[0]) < 1911) {
                parts[0] = (parseInt(parts[0]) + 1911).toString();
                dateStr = parts.join('-');
            }
            
            const dateObj = new Date(dateStr);
            if (!isNaN(dateObj.getTime())) {
                 finalDate = dateObj.toISOString().split('T')[0];
            }
        }
    } catch (e) {
        console.error("Date parsing failed, defaulting to today", e);
    }
    parsed.date = finalDate;
    
    return parsed;
  } catch (error) {
    console.error("Receipt analysis failed:", error);
    throw error;
  }
};

export const analyzeVoiceCommand = async (base64Audio: string, mimeType: string): Promise<ReceiptData & { location?: string, type?: 'INCOME' | 'EXPENSE' }> => {
    const today = new Date().toISOString().split('T')[0];
    
    // Clean base64 prefix if exists
    const cleanBase64 = base64Audio.replace(/^data:.*?;base64,/, "");
    
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
          parts: [
            {
                inlineData: {
                    mimeType: mimeType,
                    data: cleanBase64
                }
            },
            {
              text: `Current Date: ${today}.
              Listen to this audio command for a bookkeeping app.
              
              Extract the following strictly in JSON:
              - Date: Convert relative dates like "yesterday", "last friday" to YYYY-MM-DD. Default to today if not specified.
              - Amount: Number only.
              - Type: INCOME or EXPENSE. (Default to EXPENSE if ambiguous).
              - Category: Best fit from [Food, Transport, Shopping, Bills, Healthcare, Education, Travel, Entertainment, Salary, Investment].
              - Description: Brief summary in Traditional Chinese.
              - Location: If mentioned (e.g. "at 7-11"), extract it.
              
              Return JSON.`
            }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              date: { type: Type.STRING },
              amount: { type: Type.NUMBER },
              type: { type: Type.STRING, enum: ["INCOME", "EXPENSE"] },
              category: { type: Type.STRING },
              description: { type: Type.STRING },
              location: { type: Type.STRING }
            },
            required: ["date", "amount", "type", "description", "category"]
          }
        }
      });
  
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      return JSON.parse(text);
    } catch (error) {
      console.error("Voice analysis failed:", error);
      throw error;
    }
  };