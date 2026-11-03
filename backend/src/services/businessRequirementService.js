/**
 * GLOWAPP BUSINESS REQUIREMENT SERVICE
 * Rules catalog matching verticals, locations, and stages to active regulatory requirements.
 */

const businessRepository = require('../repositories/businessRepository');

class BusinessRequirementService {
  async getRequirementsForVertical(verticalCode) {
    const vertical = await businessRepository.getVerticalByCode(verticalCode);
    return businessRepository.getRequirementsByVertical(vertical.id);
  }

  async getVerticalsCatalog() {
    return businessRepository.getVerticals();
  }
}

module.exports = new BusinessRequirementService();
